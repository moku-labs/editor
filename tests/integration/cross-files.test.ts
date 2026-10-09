import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isWireError, type WireError } from "../../src/index";
import {
  bootTools,
  createProject,
  createTinyGame,
  FIRST_NOTE,
  installPage,
  PNG_1X1,
  type Stack,
  shutdown,
  startAgent,
  startServer,
  startStack,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Files across the three cores (plan §3, cross-files): the link's files client
// drives the real files plugin through the hub (F1), the sandbox holds over the
// wire (F2), flowView loads and resets its layout through the stack (F3), and
// filesView indexes, maps nodes to files and handles a conflict (F4).
// ─────────────────────────────────────────────────────────────────────────────

let stack: Stack | undefined;
const outsideDirs: string[] = [];

afterEach(async () => {
  await shutdown(stack);
  stack = undefined;
  await Promise.all(outsideDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

/**
 * The sha1 hex of a text, as the files plugin versions a file.
 *
 * @param text - The file text.
 * @returns The version.
 */
function sha1(text: string): string {
  return new Bun.CryptoHasher("sha1").update(text).digest("hex");
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
 * Starts the stack like `startStack`, but lets the test fill the project before the server and
 * the tools app see it (F3 needs a pinned layout loaded with the first session).
 *
 * @param prepare - Writes into the fresh project root.
 * @returns The live stack.
 */
async function startPreparedStack(prepare: (root: string) => Promise<void>): Promise<Stack> {
  const root = await createProject("tiny");
  await prepare(root);
  const server = await startServer(root);
  const page = installPage(server.origin, server.app.hub.path());
  const game = await createTinyGame();
  const agent = await startAgent(server, game);
  const tools = await bootTools(server);
  const { link } = tools.app;
  await until(
    () => link.status().kind === "live" && link.manifest() !== undefined,
    "a live link with a manifest"
  );
  return { kind: "stack", root, server, page, game, agent, tools };
}

/**
 * Every file path under a folder, through the link's files client, recursively.
 *
 * @param list - The files client's list.
 * @param dir - The folder ("" for the root).
 * @returns The file paths, sorted.
 */
async function listRecursive(
  list: (dir: string) => Promise<readonly { path: string; kind: "file" | "dir" }[]>,
  dir: string
): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await list(dir)) {
    if (entry.kind === "dir") found.push(...(await listRecursive(list, entry.path)));
    else found.push(entry.path);
  }
  return found.toSorted();
}

/**
 * The texts of the toasts in the page.
 *
 * @param stackNow - The live stack.
 * @returns One text per visible toast.
 */
function toastTexts(stackNow: Stack): string[] {
  return [...stackNow.page.root.querySelectorAll("[data-toast]")].map(
    toast => toast.textContent ?? ""
  );
}

/**
 * The `src` attribute of the game frame, or "" when there is no frame or no src.
 *
 * @param stackNow - The live stack.
 * @returns The src.
 */
function frameSrc(stackNow: Stack): string {
  return stackNow.page.window.document.querySelector("iframe")?.getAttribute("src") ?? "";
}

describe("cross-files: the files channel through the stack", () => {
  it("F1: round-trips list, read, write, writeBinary and readBinary and emits files:written", async () => {
    stack = await startStack();
    const { server, tools, root } = stack;
    const files = tools.app.link.files;

    const entries = await files.list("");
    const top = entries.map(entry => entry.path);
    expect(top).toEqual(
      expect.arrayContaining(["nodes", "flows", "features", "generated", ".moku"])
    );
    expect(top).not.toContain("node_modules");
    expect(top).not.toContain(".env");

    const home = await files.read("nodes/home.ts");
    expect(home.version).toBe(sha1(home.text));
    const homeOnServer = await server.app.files.read("nodes/home.ts");
    expect(homeOnServer.text).toBe(home.text);

    const edited = `${home.text}// edited over the wire\n`;
    const written = await files.write("nodes/home.ts", edited, home.version);
    expect(written).toEqual({
      path: "nodes/home.ts",
      bytes: Buffer.byteLength(edited),
      version: sha1(edited)
    });
    expect(await readFile(path.join(root, "nodes/home.ts"), "utf8")).toBe(edited);
    expect(server.written).toContainEqual(
      expect.objectContaining({ path: "nodes/home.ts", kind: "code" })
    );

    const stale = await rejectionOf(files.write("nodes/home.ts", "stale\n", home.version));
    expect(stale.code).toBe(-32_005);
    expect(stale.data?.reason).toBe("version_conflict");
    expect(await readFile(path.join(root, "nodes/home.ts"), "utf8")).toBe(edited);

    const capture = ".moku/captures/new/a.png";
    expect(existsSync(path.join(root, ".moku/captures/new"))).toBe(false);
    await files.writeBinary(capture, PNG_1X1);
    expect(existsSync(path.join(root, capture))).toBe(true);
    expect(server.written).toContainEqual(
      expect.objectContaining({ path: capture, kind: "capture" })
    );
    const image = await files.readBinary(capture);
    expect(image.dataUrl).toBe(PNG_1X1);

    const [serverSide, linkSide] = await Promise.all([
      server.app.files.read("nodes/home.ts"),
      files.read("nodes/home.ts")
    ]);
    expect(serverSide.text).toBe(linkSide.text);
  });

  it("F2: keeps the sandbox over the wire: every escape rejects -32004 and nothing lands outside", async () => {
    stack = await startStack();
    const { server, tools, root } = stack;
    const files = tools.app.link.files;
    const parent = path.dirname(root);

    const outside = await realpath(await mkdtemp(path.join(tmpdir(), "moku-outside-")));
    outsideDirs.push(outside);
    await writeFile(path.join(outside, "secret.ts"), "export const secret = 1;\n");
    await symlink(path.join(outside, "secret.ts"), path.join(root, "nodes/out.ts"));
    const parentX = path.join(parent, "x.ts");
    const hadParentX = existsSync(parentX);

    // All calls go out at once; each gets its rejection handler at once, so a call that fails
    // while an earlier one is still awaited is never an unhandled rejection.
    const calls: [string, Promise<Error & WireError>][] = [
      ["read ../outside.ts", rejectionOf(files.read("../outside.ts"))],
      ["read /etc/hosts", rejectionOf(files.read("/etc/hosts"))],
      ["write nodes/../../x.ts", rejectionOf(files.write("nodes/../../x.ts", "x"))],
      ["read nodes/out.ts (symlink escape)", rejectionOf(files.read("nodes/out.ts"))],
      ["read .env", rejectionOf(files.read(".env"))],
      ["write a.exe", rejectionOf(files.write("a.exe", "x"))],
      ["readBinary nodes/home.ts", rejectionOf(files.readBinary("nodes/home.ts"))]
    ];
    for (const [label, rejection] of calls) {
      const error = await rejection;
      expect({ label, code: error.code, reason: error.data?.reason }).toEqual({
        label,
        code: -32_004,
        reason: "forbidden_path"
      });
    }

    expect(() => server.app.files.resolve("../x")).toThrow("[moku-editor]");
    expect(existsSync(parentX)).toBe(hadParentX);
    expect(existsSync(path.join(root, "a.exe"))).toBe(false);
    expect(await readFile(path.join(outside, "secret.ts"), "utf8")).toBe(
      "export const secret = 1;\n"
    );
    expect(server.written).toEqual([]);
  });
});

describe("cross-files: views write through the stack", () => {
  it("F3: flowView loads the pinned layout and resets it through the stack", async () => {
    stack = await startPreparedStack(async root => {
      await mkdir(path.join(root, ".moku/editor"), { recursive: true });
      // A layout.json of an older editor: its notes field still loads and is ignored.
      await writeFile(
        path.join(root, ".moku/editor/layout.json"),
        `${JSON.stringify({ version: 1, nodes: { "main/home": { x: 48, y: 24 } }, notes: {} })}\n`
      );
    });
    const live = stack;
    const { server, tools } = live;
    const { flowView } = tools.app;
    await until(() => flowView.layout.pinnedCount() === 1, "the pinned layout loaded");

    await flowView.layout.reset();
    expect(flowView.layout.pinnedCount()).toBe(0);
    expect(server.written).toContainEqual(
      expect.objectContaining({ path: ".moku/editor/layout.json", kind: "layout" })
    );
    const layoutFile = await server.app.files.read(".moku/editor/layout.json");
    const layout: { nodes: Record<string, unknown> } = JSON.parse(layoutFile.text);
    expect(layout.nodes).toEqual({});
  });

  it("F4: filesView indexes the root, maps nodes to files and resolves a save conflict", async () => {
    stack = await startStack();
    const live = stack;
    const { server, tools, root } = live;
    const { filesView, link } = tools.app;
    const note = FIRST_NOTE;

    await filesView.refresh();
    let changes = 0;
    filesView.subscribe(() => {
      changes += 1;
    });
    expect(
      filesView
        .files()
        .map(entry => entry.path)
        .toSorted()
    ).toEqual(await listRecursive(dir => link.files.list(dir), ""));
    expect(filesView.files().some(entry => entry.path.includes("node_modules"))).toBe(false);
    expect(filesView.files().some(entry => entry.path === ".env")).toBe(false);

    await filesView.open("flows/main.ts", { line: 3 });
    await filesView.open(note);
    filesView.setMode(note, "source");
    expect(filesView.tabs().map(tab => tab.path)).toEqual(["flows/main.ts", note]);
    expect(filesView.active()).toBe(note);
    filesView.activate("flows/main.ts");
    expect(filesView.active()).toBe("flows/main.ts");

    // The project index answers where a node and a flow are defined, and who uses the node.
    await until(() => link.project()?.state === "on", "the project index on");
    expect(filesView.fileOf({ flow: "main", node: "home" })).toBe("nodes/home.ts");
    expect(filesView.flowFileOf("visit")).toBe("flows/visit.ts");
    expect(filesView.fileOf({ flow: "main", node: "nowhere" })).toBeUndefined();
    const usedBy = filesView.usedBy("nodes/home.ts");
    expect(usedBy.nodes).toEqual([{ flow: "main", node: "home" }]);
    expect(usedBy.usedIn).toEqual(["flows/main.ts"]);
    expect(filesView.editorUrl("nodes/home.ts", 3)).toBe(`vscode://file${root}/nodes/home.ts:3`);

    const srcBefore = frameSrc(live);
    expect(srcBefore).not.toBe("");
    const runsBefore = server.tap.requests("tools", "run").length;
    const { text: original } = await link.files.read(note);
    filesView.edit(true, note);
    filesView.setBuffer(note, `${original}\nmore`);
    const saved = await filesView.save(note);
    expect(saved).toMatchObject({ kind: "saved", path: note, reload: false });
    expect(await readFile(path.join(root, note), "utf8")).toBe(`${original}\nmore`);
    await until(
      () => toastTexts(live).some(toast => toast.includes(note)),
      "a toast naming the saved note"
    );
    expect(frameSrc(live)).toBe(srcBefore);
    expect(server.tap.requests("tools", "run").length).toBe(runsBefore);

    const current = await server.app.files.read(note);
    await server.app.files.write(note, `${current.text}\ndisk one`, current.version);
    filesView.setBuffer(note, `${original}\nbuffer one`);
    const firstConflict = await filesView.save(note);
    expect(firstConflict.kind).toBe("conflict");
    const reloaded = await filesView.resolveConflict(note, "reload");
    expect(reloaded.kind).toBe("unchanged");
    expect(filesView.tabs().find(tab => tab.path === note)?.modified).toBe(false);
    expect(await readFile(path.join(root, note), "utf8")).toBe(`${current.text}\ndisk one`);

    const again = await server.app.files.read(note);
    await server.app.files.write(note, `${again.text}\ndisk two`, again.version);
    filesView.setBuffer(note, `${original}\nbuffer two`);
    const secondConflict = await filesView.save(note);
    expect(secondConflict.kind).toBe("conflict");
    const overwritten = await filesView.resolveConflict(note, "overwrite");
    expect(overwritten.kind).toBe("saved");
    expect(await readFile(path.join(root, note), "utf8")).toBe(`${original}\nbuffer two`);

    expect(changes).toBeGreaterThan(0);
    filesView.setBuffer(note, `${original}\nunsaved`);
    expect(filesView.close(note, { discard: true })).toBe(true);
    expect(filesView.tabs().map(tab => tab.path)).toEqual(["flows/main.ts"]);
  });
});
