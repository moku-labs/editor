import { readFile } from "node:fs/promises";
import path from "node:path";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MERGE_NAME, type MergeGame, startMergeGame } from "./helpers/merge";
import {
  bootTools,
  createProject,
  installPage,
  type Page,
  PNG_1X1,
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
// A pick for the chat on the real merge game (round 2 R2), across gameView,
// files, the capture plugin and the game's bookmark doors. Local only:
// helpers/merge.ts calls loadMergeGame, which needs the pinned game checkout,
// so vitest.config.ts skips this file on CI (its text names loadMergeGame).
// The settings popup is open; Reference mode is on; a click on the
// settingsBoard proxy writes the crop, the full frame and the card file with
// the reference block (round 2b R13), puts the one reference line naming the
// card on the clipboard, and its bookmark brings the game back to the popup.
// ─────────────────────────────────────────────────────────────────────────────

/** Three cores and a real game start for the test. */
const TIMEOUT_MS = 30_000;

/** The PNG the stubbed canvas answers for the crop. */
const CROP_PNG = "data:image/png;base64,Q1JPUA==";

/** Where the settings popup rests in the board flow. */
const SETTINGS_OPEN = "board/settings/open";

/** The one clipboard line of the pick: name, type, flow node, source, ref bounds, card. */
const LINE =
  /^@moku settingsBoard panel · settingsPopup\/open · features\/settings\/settings\.tsx:301 · ref \d+,\d+ \d+×\d+ · (\.moku\/captures\/settingsBoard-f\d+\.md)$/;

/** The reference block inside the card file: its `text` fence. */
const TEXT_FENCE = /^```text\n([\s\S]*?)\n```$/m;

/** The lines a pick with every fact known prints, in order. */
const BLOCK_LINES = [
  "@moku ",
  "path: ",
  "source: ",
  "layout: ",
  "bounds: ",
  "state: ",
  "flow: ",
  "game: ",
  "device: ",
  "restore: ",
  "shot: "
];

const running: (Stoppable | undefined)[] = [];
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  unhandled?.stop();
  unhandled = undefined;
  vi.restoreAllMocks();
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
type PickStack = {
  readonly root: string;
  readonly server: ServerStack;
  readonly page: Page;
  readonly game: MergeGame;
  readonly tools: ToolsStack;
};

/** What the test uses of the screen game's renderer: the capture `game.capture` runs. */
type CapturingApp = { readonly renderer: { capture(): Promise<unknown> } };

/**
 * Starts the merge project, the screen game on the board, the agent and the tools, and waits
 * for the live link. The screen game's renderer is inert and answers no picture, so its capture
 * answers a PNG here (`withRenderer` cannot wrap the frozen screen app: its `renderer` is a
 * non-configurable property the layout doors read too).
 *
 * @returns The stack.
 */
async function pickStack(): Promise<PickStack> {
  unhandled = trackUnhandled();
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const root = await createProject("merge");
  const server = keep(await startServer(root));
  const page = installPage(server.origin, server.app.hub.path());
  const game = keep(await startMergeGame({ screen: true, board: true }));
  keep(await startAgent(server, game, { modules: [], name: MERGE_NAME }));
  const { renderer } = game.app as unknown as CapturingApp;
  vi.spyOn(renderer, "capture").mockResolvedValue(PNG_1X1);
  const tools = keep(await bootTools(server, {}));
  const { link } = tools.app;
  await until(
    () => link.status().kind === "live" && link.manifest()?.game === MERGE_NAME,
    "a live link with the merge manifest"
  );
  return { root, server, page, game, tools };
}

/**
 * The tools page's clipboard and 2D canvas, which happy-dom and the test runtime do not have:
 * the clipboard records what is written, the picture decodes at the given size, the canvas
 * answers a fixed PNG.
 *
 * @param page - The installed page.
 * @param picture - The size of every decoded picture.
 * @param picture.width - Its width in pixels.
 * @param picture.height - Its height in pixels.
 * @returns The texts written to the clipboard.
 */
function stubTheBrowser(page: Page, picture: { width: number; height: number }): string[] {
  const written: string[] = [];
  vi.stubGlobal("navigator", {
    platform: "MacIntel",
    userAgent: "test",
    clipboard: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      }
    }
  });

  /** A decoded picture of the given size. */
  class StubImage {
    src = "";
    readonly naturalWidth = picture.width;
    readonly naturalHeight = picture.height;
    /** Decodes at once. */
    decode(): Promise<void> {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("Image", StubImage);
  const canvas = page.window.HTMLCanvasElement.prototype;
  const context = { drawImage: () => undefined };
  vi.spyOn(canvas, "getContext").mockImplementation(
    (() => context) as unknown as typeof canvas.getContext
  );
  vi.spyOn(canvas, "toDataURL").mockReturnValue(CROP_PNG);
  return written;
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
 * The Reference mode proxy of the settings board.
 *
 * @returns The proxy element, or null while none is drawn.
 */
function proxy(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-moku-proxy][data-moku-key="settingsBoard"]');
}

/**
 * The data URL a project file was written with, from the PNG bytes on disk.
 *
 * @param root - The project root.
 * @param file - The file under the root.
 * @returns `data:image/png;base64,…`.
 */
async function pngOf(root: string, file: string): Promise<string> {
  const bytes = await readFile(path.join(root, file));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/**
 * The card a reference line names and the reference block in its `text` fence.
 *
 * @param root - The project root.
 * @param line - The clipboard line.
 * @returns The card path, its text and the block lines.
 */
async function cardOf(
  root: string,
  line: string
): Promise<{ card: string; text: string; lines: string[] }> {
  const [, card = ""] = LINE.exec(line) ?? [];
  const text = await readFile(path.join(root, card), "utf8");
  const [, block = ""] = TEXT_FENCE.exec(text) ?? [];
  return { card, text, lines: block.split("\n") };
}

describe("a pick for the chat on merge-game (round 2 R2, 2b R13)", () => {
  it(
    "writes the crop, the full frame and the card, copies the one line, and its bookmark restores the popup",
    async () => {
      const live = await pickStack();
      const { tools, game, root, page } = live;
      const { link, gameView, workspace } = tools.app;

      // 1. Open the settings popup and wait for its calibrated scene.
      await link.run("game.answer", { intent: "openSettings" });
      await until(() => steppedTo(game, SETTINGS_OPEN), SETTINGS_OPEN);
      await until(async () => {
        await game.frames(1);
        const scene = await gameView.scene();
        return scene.calibrated && scene.nodes.has("ui:settingsScreen/settingsBoard");
      }, "the calibrated scene of the settings popup");

      // 2. Reference mode on: the proxy of the settings board; a click on it picks.
      const written = stubTheBrowser(page, { width: 1080, height: 1440 });
      workspace.setReference(true);
      await until(() => proxy() !== null, "the settingsBoard proxy");
      expect(proxy()?.dataset.mokuRefBounds).toMatch(/^\d+ \d+ \d+ \d+$/);
      expect(proxy()?.dataset.mokuFrame).toMatch(/^\d+$/);
      await act(() => {
        proxy()?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      await until(() => written.length > 0, "the reference line on the clipboard");

      // 3. One line names the card; the card holds every producible block line, in order; the
      //    restore and shot lines name what was saved, the images link the two PNGs.
      const [line = ""] = written;
      expect(line).toMatch(LINE);
      const { card, text, lines } = await cardOf(root, line);
      expect(card).toMatch(/^\.moku\/captures\/settingsBoard-f\d+\.md$/);
      expect(text.split("\n")[0]).toBe("# @moku settingsBoard panel");
      expect(lines.map(line => BLOCK_LINES.find(prefix => line.startsWith(prefix)))).toEqual(
        BLOCK_LINES
      );
      expect(lines[0]).toMatch(/^@moku settingsBoard · panel · settingsPopup\/open · f\d+$/);
      expect(lines[1]).toBe("path: settingsScreen/settingsBoard");
      expect(lines[2]).toBe(
        "source: features/settings/settings.tsx:301 · texture: ui.panel-signboard"
      );
      expect(lines[3]).toMatch(/^layout: settingsScreen \(column, padding 0\/0\/0\/0\)$/);
      expect(lines[6]).toMatch(
        /^flow: board > settings > open · last: board\/settings\/enter → done/
      );
      expect(lines[7]).toMatch(
        /^game: merge-game 0\.0\.0 · s-\S+ · f\d+ · \d\d:\d\d:\d\d · live · clean$/
      );
      expect(lines[8]).toBe("device: iPhone 18 Pro 402×874 portrait · dpr 3 · safe 62/0/34/0");

      const [bookmark] = gameView.bookmarks();
      if (bookmark === undefined) throw new Error("the pick kept no bookmark");
      expect(lines[9]).toBe(`restore: bookmark ${bookmark.id}`);
      const shot = /^shot: (\S+) · frame: (\S+)$/.exec(lines[10] ?? "");
      const [, crop = "", full = ""] = shot ?? [];
      expect(crop).toMatch(/^\.moku\/captures\/settingsBoard-f\d+\.png$/);
      expect(full).toMatch(/^\.moku\/captures\/f\d+\.png$/);
      expect(await pngOf(root, crop)).toBe(CROP_PNG);
      expect(await pngOf(root, full)).toBe(PNG_1X1);
      expect(text).toContain(`![element](${path.basename(crop)})`);
      expect(text).toContain(`![frame](${path.basename(full)})`);
      expect(page.root.textContent).toContain("Reference, shot and bookmark copied");

      // 4. Close the popup, then restore the pick's bookmark: the game is back on it.
      await link.run("game.answer", { intent: "close" });
      await until(() => steppedTo(game, "board/awaitIntent"), "board/awaitIntent");
      await link.run("game.restore", { bookmark: bookmark.value });
      await until(() => steppedTo(game, SETTINGS_OPEN), "the popup restored");
      expect(game.app.flow.state().path).toBe(SETTINGS_OPEN);
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );
});
