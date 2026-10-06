import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, isWireError, type WireError } from "../../src/index";
import { MERGE_NAME, type MergeGame, type MergeOptions, startMergeGame } from "./helpers/merge";
import {
  bootTools,
  createProject,
  installPage,
  logErrors,
  paramsOf,
  type ServerConfigs,
  type ServerStack,
  type Stoppable,
  shutdown,
  startAgent,
  startServer,
  type ToolsStack,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// The project index end to end on the real merge game (change project-index, U10).
// Local only: helpers/merge.ts calls loadMergeGame, which needs the pinned game
// checkout (tests/fixtures/game-dir.ts), so vitest.config.ts skips this file on CI
// (its text names loadMergeGame). The files plugin opens the index of the project
// root; the views ask it where code lives and follow what an agent changes while
// the editor is open. There is no fallback (amendment N): a node in a file no
// rule would name (1), an edit above a node (2), a moved node (3), a file that
// does not parse (4), a write that lost the race (5) and the index turned off (6).
// ─────────────────────────────────────────────────────────────────────────────

/** Three cores and a real game start for each case. */
const TIMEOUT_MS = 30_000;

/** How long a view may take to follow an agent's edit: the watch debounce and its 2 s backstop. */
const FOLLOW_MS = 5000;

/** Where the settings popup rests in the board flow. */
const SETTINGS_OPEN = "board/settings/open";

/** The shared text of a style write refused while its file does not parse (D-44). */
const BROKEN_TEXT = "The file does not parse now · fix it, then edit";

const running: (Stoppable | undefined)[] = [];
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  unhandled?.stop();
  unhandled = undefined;
  await shutdown(...running.splice(0));
});

/**
 * Remembers a started part for the bounded shutdown in afterEach.
 *
 * @param part - A started part.
 * @returns The same part.
 */
function keep<Part extends Stoppable>(part: Part): Part {
  running.push(part);
  return part;
}

/** The started stack. */
type IndexStack = {
  readonly root: string;
  readonly server: ServerStack;
  readonly game: MergeGame;
  readonly tools: ToolsStack;
};

/** Which merge game the stack serves and what the server takes. */
type IndexChoice = {
  /** Default: headless at splash. */
  readonly game?: MergeOptions;
  /** Extra server pluginConfigs, e.g. `{ files: { project: false } }`. */
  readonly server?: ServerConfigs;
};

/**
 * Starts the merge project, a merge game, the agent and the tools, and waits until the link is
 * live with the merge manifest and holds the first project state. Tracks unhandled rejections.
 *
 * @param choice - Which game, and the server configs.
 * @returns The stack.
 */
async function indexStack(choice: IndexChoice = {}): Promise<IndexStack> {
  unhandled = trackUnhandled();
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const root = await createProject("merge");
  const server = keep(await startServer(root, choice.server));
  installPage(server.origin, server.app.hub.path());
  const game = keep(await startMergeGame(choice.game));
  keep(await startAgent(server, game, { modules: [], name: MERGE_NAME }));
  const tools = keep(await bootTools(server));
  const { link } = tools.app;
  await until(
    () =>
      link.status().kind === "live" &&
      link.manifest()?.game === MERGE_NAME &&
      link.project() !== undefined,
    "a live link with the merge manifest and a project state"
  );
  return { root, server, game, tools };
}

/**
 * Steps one 16 ms frame unless the game is there, then reads its path.
 *
 * @param game - The merge game.
 * @param where - The path to reach.
 * @returns Whether the game is there.
 */
async function steppedTo(game: MergeGame, where: string): Promise<boolean> {
  if (game.app.flow.state().path === where) return true;
  await game.frames(1);
  return game.app.flow.state().path === where;
}

/**
 * One element under a root, failing loudly when it is missing.
 *
 * @param root - Where to look.
 * @param selector - A CSS selector.
 * @returns The element.
 * @throws {Error} When nothing matches.
 */
function elementIn(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no element matches ${selector}`);
  return element;
}

/**
 * Clicks an element inside `act`, so Preact renders what the click changed.
 *
 * @param element - The element.
 * @returns Resolves after the render.
 */
async function click(element: HTMLElement): Promise<void> {
  await act(() => {
    element.click();
  });
}

/**
 * Selects a node in Flow and opens the Inspector's Code tab.
 *
 * @param tools - The tools stack.
 * @param id - The node id, e.g. "board/merge".
 * @returns The Flow host.
 * @throws {Error} When the Inspector has no Code tab.
 */
async function codeTabOf(tools: ToolsStack, id: string): Promise<HTMLElement> {
  const { workspace, flowView } = tools.app;
  workspace.show("flow");
  const flow = workspace.host("flow");
  await until(() => flowView.focus.select(id), `${id} selectable`);
  await until(
    () => flow.querySelector('[data-flow="inspector"] [role="tab"]') !== null,
    "the Inspector tabs"
  );
  const tab = [...flow.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')].find(
    candidate => candidate.textContent.startsWith("Code")
  );
  if (tab === undefined) throw new Error("no Code tab in the Inspector");
  await click(tab);
  return flow;
}

/**
 * Where the Code tab stands: the path it shows and its highlighted line.
 *
 * @param flow - The Flow host.
 * @returns `path:line`, or undefined while the tab shows no file.
 */
function codeAt(flow: HTMLElement): string | undefined {
  const tab = flow.querySelector('[data-flow="code-tab"]');
  const file = tab?.querySelector('[data-part="path"]')?.textContent;
  const line = tab?.querySelector<HTMLElement>("[data-highlight]")?.dataset.line;
  return file === undefined || line === undefined ? undefined : `${file}:${line}`;
}

/**
 * The rejection of a call that must fail with a wire error.
 *
 * @param call - The call.
 * @returns The wire error it rejected with.
 */
async function rejectionOf(call: Promise<unknown>): Promise<Error & WireError> {
  const outcome = await call.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!(outcome instanceof Error) || !isWireError(outcome)) {
    throw new Error(`expected a wire error rejection, got ${String(outcome)}`);
  }
  return outcome;
}

/**
 * True when the project state link holds lists a file in the change of its last batch.
 *
 * @param tools - The tools stack.
 * @param file - A root-relative file.
 * @returns Whether the last batch changed the file.
 */
function batchChanged(tools: ToolsStack, file: string): boolean {
  const project = tools.app.link.project();
  return project?.state === "on" && project.change?.files.includes(file) === true;
}

describe("project index: where code lives", () => {
  it(
    "1: the Code tab opens a node in a file no rule would name, at its line",
    async () => {
      const { tools } = await indexStack({ game: { board: true } });
      const { link } = tools.app;

      // features/settings/nodes.ts holds every node of settingsPopup; `open` is not its own file.
      const flow = await codeTabOf(tools, "settingsPopup/open");
      await until(
        () => codeAt(flow) === "features/settings/nodes.ts:106",
        "the Code tab at settingsPopup/open"
      );
      const [found] = await link.files.find("node:settingsPopup/open");
      expect(found).toMatchObject({
        path: "features/settings/nodes.ts",
        line: 106,
        binding: "open"
      });
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "2: an edit above a node moves its line at once, and the Code tab follows the batch",
    async () => {
      const { tools, root } = await indexStack({ game: { board: true } });
      const { link } = tools.app;
      const flow = await codeTabOf(tools, "board/merge");
      await until(() => codeAt(flow) === "nodes/merge.ts:17", "the Code tab at board/merge");

      // An agent puts three lines above the node.
      const file = path.join(root, "nodes/merge.ts");
      const text = await readFile(file, "utf8");
      const at = text.indexOf("export const merge ");
      const edited = `${text.slice(0, at)}// one\n// two\n// three\n${text.slice(at)}`;
      await writeFile(file, edited);

      // `find` reads the line from disk at the call, before any batch.
      const [found] = await link.files.find("node:board/merge");
      expect(found).toMatchObject({ path: "nodes/merge.ts", line: 20 });
      expect(found?.hash).toBe(new Bun.CryptoHasher("sha1").update(edited).digest("hex"));

      // The batch arrives as link:project; the Code tab reads its node again.
      await until(() => batchChanged(tools, "nodes/merge.ts"), "the batch of the edit", FOLLOW_MS);
      await until(() => codeAt(flow) === "nodes/merge.ts:20", "the Code tab at line 20", FOLLOW_MS);
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "3: a moved node takes its open tab along, with the note and its Used by",
    async () => {
      const { tools, root } = await indexStack({ game: { board: true } });
      const { workspace, filesView } = tools.app;
      await filesView.open("nodes/catch-up.ts");
      await until(() => filesView.tabs().at(-1)?.status === "ready", "the catch-up tab");
      expect(filesView.usedBy("nodes/catch-up.ts").nodes).toEqual([
        { flow: "board", node: "catchUp" }
      ]);

      // An agent moves the node one folder down and fixes the imports, in one go.
      const from = path.join(root, "nodes/catch-up.ts");
      const to = path.join(root, "nodes/board/catch-up.ts");
      const board = path.join(root, "flows/board.ts");
      const node = await readFile(from, "utf8");
      const flowText = await readFile(board, "utf8");
      await mkdir(path.dirname(to), { recursive: true });
      await writeFile(to, node.replaceAll('from "../', 'from "../../'));
      await writeFile(board, flowText.replace('"../nodes/catch-up"', '"../nodes/board/catch-up"'));
      await rm(from);

      await until(
        () => filesView.active() === "nodes/board/catch-up.ts",
        "the tab to follow the move",
        FOLLOW_MS
      );
      expect(filesView.tabs().map(tab => tab.path)).not.toContain("nodes/catch-up.ts");
      expect(filesView.tabs().at(-1)).toMatchObject({ status: "ready", modified: false });
      const files = workspace.host("files");
      await until(
        () => files.textContent.includes("Moved from nodes/catch-up.ts"),
        "the moved note"
      );
      expect(filesView.fileOf({ flow: "board", node: "catchUp" })).toBe("nodes/board/catch-up.ts");
      expect(filesView.usedBy("nodes/board/catch-up.ts")).toEqual({
        flows: [],
        nodes: [{ flow: "board", node: "catchUp" }],
        usedIn: ["flows/board.ts"]
      });
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "4: a style step on a file that does not parse writes nothing and says why",
    async () => {
      const { tools, root, server, game } = await indexStack({
        game: { screen: true, board: true }
      });
      const { link, gameView, workspace } = tools.app;

      // The settings popup: its backdrop is styled by backdropStyle of features/ui/popup.tsx.
      await link.run("game.answer", { intent: "openSettings" });
      await until(() => steppedTo(game, SETTINGS_OPEN), SETTINGS_OPEN);
      let backdrop: Parameters<typeof gameView.select>[0] | undefined;
      await until(async () => {
        await game.frames(1);
        const scene = await gameView.scene();
        backdrop = [...scene.nodes.values()].find(node => node.key === "settingsBackdrop")?.ref;
        return scene.calibrated && backdrop !== undefined;
      }, "the settings popup with its backdrop");
      if (backdrop === undefined) throw new Error("no settings backdrop");

      // The style card of the backdrop: the block of backdropStyle, alpha with a stepper.
      gameView.select(backdrop);
      const host = workspace.host("game");
      const card = '[data-part="style-card"]';
      const alphaUp = `${card} [data-field="alpha"] button[aria-label="Increase alpha"]`;
      await until(() => host.querySelector(alphaUp) !== null, "the backdrop style card");
      const where = elementIn(host, `${card} [data-part="where"]`).textContent;
      expect(where).toMatch(/^features\/ui\/popup\.tsx:\d+$/);

      // An agent leaves popup.tsx unparseable; the index says so and the card shows it.
      const file = path.join(root, "features/ui/popup.tsx");
      await appendFile(file, "\nexport const broken = ;\n");
      const bytes = await readFile(file, "utf8");
      await until(
        () => {
          const project = link.project();
          return project?.state === "on" && Object.hasOwn(project.broken, "features/ui/popup.tsx");
        },
        "popup.tsx broken in the index",
        FOLLOW_MS
      );
      await until(() => host.textContent.includes(BROKEN_TEXT), "the broken text on the card");

      // A step asks the index before the write and writes nothing.
      const checks = (): number =>
        server.tap
          .requests("tools", "find", "files")
          .filter(message => paramsOf(message)?.key === "style:features/ui/popup.tsx#backdropStyle")
          .length;
      const checksBefore = checks();
      const writesBefore = server.tap.requests("tools", "write", "files").length;
      await click(elementIn(host, alphaUp));
      await until(() => checks() > checksBefore, "the broken check of the write");
      await until(() => host.textContent.includes(BROKEN_TEXT), "the broken text after the step");
      expect(server.tap.requests("tools", "write", "files").length).toBe(writesBefore);
      expect(server.written.some(entry => entry.path === "features/ui/popup.tsx")).toBe(false);
      expect(await readFile(file, "utf8")).toBe(bytes);
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "5: a write that lost the race to an agent is refused -32005 and keeps the agent's bytes",
    async () => {
      const { tools, root } = await indexStack();
      const { link } = tools.app;
      const file = "nodes/merge.ts";
      const read = await link.files.read(file);

      // An agent writes between the editor's read and its write.
      const agentText = `${read.text}// the agent\n`;
      await writeFile(path.join(root, file), agentText);
      const stale = await rejectionOf(
        link.files.write(file, `${read.text}// the editor\n`, read.version)
      );
      expect(stale.code).toBe(errorCode.versionConflict);
      expect(await readFile(path.join(root, file), "utf8")).toBe(agentText);
      const names = await readdir(path.join(root, "nodes"));
      expect(names.filter(name => name.includes(".tmp"))).toEqual([]);

      // From the version on disk the write goes through, and the index hears it in a batch.
      const fresh = await link.files.read(file);
      const editorText = `${fresh.text}// the editor\n`;
      const written = await link.files.write(file, editorText, fresh.version);
      expect(written.version).toBe(new Bun.CryptoHasher("sha1").update(editorText).digest("hex"));
      await until(() => batchChanged(tools, file), "the batch of the editor's write", FOLLOW_MS);
      const [found] = await link.files.find("node:board/merge");
      expect(found).toMatchObject({ path: file, line: 17, hash: written.version });
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "6: files.project false turns the index off, and every view says so once",
    async () => {
      const { tools, server } = await indexStack({
        game: { board: true },
        server: { files: { project: false } }
      });
      const { link, workspace, filesView } = tools.app;
      const off = "Project index is off: disabled";
      expect(link.project()).toEqual({ state: "off", reason: "disabled" });

      // find answers -32008; the server logged the off state once, at error level.
      const refused = await rejectionOf(link.files.find("node:board/merge"));
      expect(refused.code).toBe(errorCode.notInstalled);
      expect(
        logErrors(server.app)
          .filter(entry => entry.event === "files:project-off")
          .map(entry => entry.data)
      ).toEqual([{ reason: "disabled" }]);

      // Flow: the Code tab of a node.
      const flow = await codeTabOf(tools, "board/merge");
      const placeholder = '[data-flow="code-tab"] [data-part="placeholder"]';
      await until(() => flow.querySelector(placeholder)?.textContent === off, "the Code tab note");

      // Files: the Used by row of a node file.
      await filesView.open("nodes/merge.ts");
      const files = workspace.host("files");
      await until(
        () => files.querySelector('[data-part="used-by"]')?.textContent === `Used by · ${off}`,
        "the Used by note"
      );

      // Render: the textures card has no manifest to read.
      workspace.show("render");
      const render = workspace.host("render");
      await until(() => render.textContent.includes(off), "the textures card note");

      // The game keeps working without the index.
      expect(await link.read("game.position")).toMatchObject({ path: "board/awaitIntent" });
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );
});
