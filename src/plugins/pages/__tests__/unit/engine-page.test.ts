import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnginePageDeps,
  EnginePageOptions,
  GameCli,
  PreparePage,
  WatchKeys
} from "../../engine-page";
import {
  AGENT_SPECIFIER,
  gameFolderProblem,
  importGameCli,
  isGameFolder,
  packageRoot,
  prepareEnginePage,
  treePlugin,
  watchEngineKeys
} from "../../engine-page";

// ─────────────────────────────────────────────────────────────────────────────
// pages engine page (B5): a moku-game folder (index.ts + config.ts) gets its
// dev page from the engine's preparePage, with the editor's page agent on it,
// and an editor working tree adds its own serve plugin (D-50). The same cli
// import gives watchKeys: the bin's keys watch (D-54, D-55).
// ─────────────────────────────────────────────────────────────────────────────

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url)).replace(/\/$/, "");

/** The page a stubbed preparePage answers. */
const PAGE = { html: "/g/.moku/index.html", bunfig: "/g/.moku/bunfig.toml" };

let base: string;
let game: string;
let work: string;

/**
 * Writes a file, creating its folders.
 *
 * @param path - The absolute path.
 * @param text - The text.
 */
async function put(path: string, text = ""): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/**
 * An editor package folder: its package.json, a built bin and a source bin.
 *
 * @param folder - The package folder.
 * @param withTree - Whether it has `scripts/tree/bundle.ts` (a working tree).
 */
async function editorPackage(folder: string, withTree: boolean): Promise<void> {
  await put(join(folder, "package.json"), '{ "name": "@moku-labs/editor" }');
  await put(join(folder, "dist", "bin.mjs"));
  await put(join(folder, "src", "plugins", "pages", "bin.ts"));
  if (withTree) await put(join(folder, "scripts", "tree", "bundle.ts"));
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "moku-engine-page-")));
  game = join(base, "game");
  work = join(base, "work");
  await put(join(game, "index.ts"), "export default {};");
  await put(join(game, "config.ts"), "export default {};");
  await mkdir(work);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/**
 * A stub engine cli: preparePage answers PAGE (or throws), watchKeys answers a watcher whose
 * `close` is recorded.
 *
 * @param prepare - The preparePage stub.
 * @returns The cli, its two stubs and the watcher's close.
 */
function createCli(prepare: PreparePage = () => Promise.resolve(PAGE)) {
  const preparePage = vi.fn<PreparePage>(prepare);
  const close = vi.fn<() => void>();
  const watchKeys = vi.fn<WatchKeys>(() => Promise.resolve({ close }));
  const cli: GameCli = { preparePage, watchKeys };
  return { cli, preparePage, watchKeys, close };
}

/**
 * Engine page deps whose import answers a stub cli (`createCli`).
 *
 * @param prepare - The preparePage stub.
 * @returns The deps, the cli and its stubs.
 */
function createDeps(prepare: PreparePage = () => Promise.resolve(PAGE)) {
  const stub = createCli(prepare);
  const deps: EnginePageDeps = { importCli: vi.fn(() => Promise.resolve(stub.cli)) };
  return { deps, ...stub };
}

/**
 * A fake engine package in a folder's node_modules whose cli exports only the names given.
 *
 * @param root - The folder that resolves the engine.
 * @param names - The functions the cli exports.
 */
async function fakeEngine(root: string, names: readonly string[]): Promise<void> {
  const engine = join(root, "node_modules", "@moku-labs", "game");
  await put(
    join(engine, "package.json"),
    '{ "name": "@moku-labs/game", "type": "module", "exports": { "./cli": "./cli.mjs" } }'
  );
  const lines = names.map(name => `export const ${name} = () => 0;`);
  await put(join(engine, "cli.mjs"), `${lines.join("\n")}\n`);
}

/**
 * Engine page options with the cwd `work` and a bin outside any editor tree.
 *
 * @param overrides - Options to replace.
 * @returns The options.
 */
function options(overrides: Partial<EnginePageOptions> = {}): EnginePageOptions {
  return {
    preload: [],
    servePlugins: [],
    cwd: work,
    main: join(base, "bin", "moku-editor.mjs"),
    ...overrides
  };
}

describe("isGameFolder", () => {
  it("answers true for a folder with index.ts and config.ts", () => {
    expect(isGameFolder(game)).toBe(true);
  });

  it("answers false without index.ts, without config.ts, or when one is a folder", async () => {
    expect(isGameFolder(work)).toBe(false);
    await put(join(work, "index.ts"));
    expect(isGameFolder(work)).toBe(false);
    await mkdir(join(work, "config.ts"));
    expect(isGameFolder(work)).toBe(false);
    expect(isGameFolder(join(base, "missing"))).toBe(false);
  });
});

describe("gameFolderProblem", () => {
  it("answers undefined for a moku-game folder and the error line otherwise", () => {
    expect(gameFolderProblem(game)).toBeUndefined();
    expect(gameFolderProblem(work)).toBe(
      `[moku-editor] ${work} has no index.ts and config.ts: pass the game HTML file, or run in a moku-game folder`
    );
  });
});

describe("packageRoot", () => {
  it("finds this repository from its source bin", () => {
    expect(packageRoot(join(REPO, "src", "plugins", "pages", "bin.ts"))).toBe(REPO);
  });

  it("finds the editor package from dist/bin.mjs and from src/plugins/pages/bin.ts", async () => {
    const editor = join(base, "editor");
    await editorPackage(editor, true);
    expect(packageRoot(join(editor, "dist", "bin.mjs"))).toBe(editor);
    expect(packageRoot(join(editor, "src", "plugins", "pages", "bin.ts"))).toBe(editor);
  });

  it("answers the real path of an editor reached through a symlink", async () => {
    const editor = join(base, "editor");
    await editorPackage(editor, true);
    await symlink(editor, join(base, "linked"), "dir");
    expect(packageRoot(join(base, "linked", "dist", "bin.mjs"))).toBe(editor);
  });

  it("skips other packages and broken package.json files on the way up", async () => {
    const editor = join(base, "editor");
    await editorPackage(editor, false);
    await put(join(editor, "node_modules", "other", "package.json"), '{ "name": "other" }');
    await put(join(editor, "node_modules", "other", "lib", "package.json"), "{ not json");
    await put(join(editor, "node_modules", "other", "lib", "x.js"));
    expect(packageRoot(join(editor, "node_modules", "other", "lib", "x.js"))).toBe(editor);
  });

  it("answers undefined for a file outside any editor package", async () => {
    await put(join(work, "package.json"), '{ "name": "work" }');
    await put(join(work, "bin.mjs"));
    expect(packageRoot(join(work, "bin.mjs"))).toBeUndefined();
  });
});

describe("treePlugin (D-50)", () => {
  it("answers the tree's scripts/tree/bundle.ts for an editor working tree", async () => {
    const editor = join(base, "editor");
    await editorPackage(editor, true);
    expect(treePlugin(editor, game)).toBe(join(editor, "scripts", "tree", "bundle.ts"));
  });

  it("answers undefined without an editor root or without the tree file", async () => {
    const editor = join(base, "editor");
    await editorPackage(editor, false);
    expect(treePlugin(undefined, game)).toBeUndefined();
    expect(treePlugin(editor, game)).toBeUndefined();
  });

  it("answers undefined for an editor installed in the game, also through a symlinked root", async () => {
    const installed = join(game, "node_modules", "@moku-labs", "editor");
    await editorPackage(installed, true);
    expect(treePlugin(installed, game)).toBeUndefined();
    await symlink(game, join(base, "game-link"), "dir");
    expect(treePlugin(installed, join(base, "game-link"))).toBeUndefined();
  });
});

describe("prepareEnginePage", () => {
  it("prepares the page with the editor's agent and answers the engine's paths with the cli", async () => {
    const { deps, cli, preparePage, watchKeys } = createDeps();
    const prepared = await prepareEnginePage(game, options(), deps);
    expect(prepared).toEqual({ page: PAGE, cli });
    // The very cli of the one import: the caller starts the keys watch with it.
    expect(typeof prepared === "string" ? undefined : prepared.cli).toBe(cli);
    expect(deps.importCli).toHaveBeenCalledTimes(1);
    expect(deps.importCli).toHaveBeenCalledWith(game);
    expect(watchKeys).not.toHaveBeenCalled();
    expect(preparePage).toHaveBeenCalledWith(game, {
      agents: [AGENT_SPECIFIER],
      preload: [],
      servePlugins: []
    });
    expect(AGENT_SPECIFIER).toBe("@moku-labs/editor/agent/page");
  });

  it("resolves relative preloads and plugins against the cwd, absolute ones stay", async () => {
    const { deps, preparePage } = createDeps();
    const given = options({
      preload: ["tree/preload.ts", "/abs/preload.ts"],
      servePlugins: ["../engine/bundle.ts"]
    });
    await prepareEnginePage(game, given, deps);
    expect(preparePage).toHaveBeenCalledWith(game, {
      agents: [AGENT_SPECIFIER],
      preload: [join(work, "tree", "preload.ts"), "/abs/preload.ts"],
      servePlugins: [join(base, "engine", "bundle.ts")]
    });
  });

  it("appends the editor tree's plugin after the given ones, once", async () => {
    const editor = join(base, "editor");
    await editorPackage(editor, true);
    const tree = join(editor, "scripts", "tree", "bundle.ts");
    const main = join(editor, "dist", "bin.mjs");
    const { deps, preparePage } = createDeps();

    await prepareEnginePage(game, options({ main, servePlugins: ["p.ts"] }), deps);
    expect(preparePage.mock.calls[0]?.[1]?.servePlugins).toEqual([join(work, "p.ts"), tree]);

    await prepareEnginePage(game, options({ main, servePlugins: [tree] }), deps);
    expect(preparePage.mock.calls[1]?.[1]?.servePlugins).toEqual([tree]);
  });

  it("adds no plugin for an editor installed in the game", async () => {
    const installed = join(game, "node_modules", "@moku-labs", "editor");
    await editorPackage(installed, true);
    const { deps, preparePage } = createDeps();
    await prepareEnginePage(game, options({ main: join(installed, "dist", "bin.mjs") }), deps);
    expect(preparePage.mock.calls[0]?.[1]?.servePlugins).toEqual([]);
  });

  it("answers the error line for a folder that is not a moku-game, without importing", async () => {
    const { deps } = createDeps();
    await expect(prepareEnginePage(work, options(), deps)).resolves.toBe(
      `[moku-editor] ${work} has no index.ts and config.ts: pass the game HTML file, or run in a moku-game folder`
    );
    expect(deps.importCli).not.toHaveBeenCalled();
  });

  it("answers the install hint when @moku-labs/game/cli does not import", async () => {
    const deps: EnginePageDeps = { importCli: () => Promise.reject(new Error("not found")) };
    await expect(prepareEnginePage(game, options(), deps)).resolves.toBe(
      `[moku-editor] @moku-labs/game/cli does not resolve from ${game}: install @moku-labs/game >=0.13.1 in the game`
    );
  });

  it("answers the >=0.13.1 install hint for an engine without watchKeys (0.10.0 to 0.13.0), and for one without preparePage", async () => {
    const deps: EnginePageDeps = { importCli: importGameCli };
    await fakeEngine(game, ["runCli", "preparePage"]);
    await expect(prepareEnginePage(game, options(), deps)).resolves.toBe(
      `[moku-editor] @moku-labs/game/cli does not resolve from ${game}: install @moku-labs/game >=0.13.1 in the game`
    );

    const older = join(base, "older");
    await put(join(older, "index.ts"), "export default {};");
    await put(join(older, "config.ts"), "export default {};");
    await fakeEngine(older, ["runCli", "watchKeys"]);
    await expect(prepareEnginePage(older, options(), deps)).resolves.toBe(
      `[moku-editor] @moku-labs/game/cli does not resolve from ${older}: install @moku-labs/game >=0.13.1 in the game`
    );
  });

  it("answers the engine's own [game] message when preparePage throws", async () => {
    const refused = createDeps(() =>
      Promise.reject(new Error("[game] config.ts: page.title must be a string, got 1."))
    );
    await expect(prepareEnginePage(game, options(), refused.deps)).resolves.toBe(
      "[game] config.ts: page.title must be a string, got 1."
    );
    const odd = createDeps(() => Promise.reject("plain text"));
    await expect(prepareEnginePage(game, options(), odd.deps)).resolves.toBe("plain text");
  });
});

describe("importGameCli", () => {
  it("imports the engine's cli the game resolves, with preparePage and watchKeys", async () => {
    const cli = await importGameCli(REPO);
    expect(typeof cli.preparePage).toBe("function");
    expect(typeof cli.watchKeys).toBe("function");
  });

  it("rejects for a root that does not resolve @moku-labs/game/cli", async () => {
    // With no node_modules up the tree Bun auto-installs from its global cache: a real game has one.
    await mkdir(join(work, "node_modules"));
    await expect(importGameCli(work)).rejects.toThrow();
  });

  it("rejects for a cli without preparePage (an engine before 0.10.0)", async () => {
    await fakeEngine(work, ["runCli"]);
    await expect(importGameCli(work)).rejects.toThrow(
      "[moku-editor] @moku-labs/game/cli has no preparePage"
    );
  });

  it("rejects for a cli without watchKeys (an engine before 0.13.1)", async () => {
    await fakeEngine(work, ["runCli", "preparePage"]);
    await expect(importGameCli(work)).rejects.toThrow(
      "[moku-editor] @moku-labs/game/cli has no watchKeys"
    );
  });

  it("answers a cli that has both functions", async () => {
    await fakeEngine(work, ["runCli", "preparePage", "watchKeys"]);
    const cli = await importGameCli(work);
    expect(typeof cli.preparePage).toBe("function");
    expect(typeof cli.watchKeys).toBe("function");
  });
});

describe("watchEngineKeys (D-54, D-55)", () => {
  it("starts the engine's watch for the root with the given onError and answers the watcher", async () => {
    const { cli, watchKeys, preparePage } = createCli();
    const onError = vi.fn<(message: string) => void>();
    const keys = await watchEngineKeys(game, cli, onError);

    expect(watchKeys).toHaveBeenCalledTimes(1);
    expect(watchKeys).toHaveBeenCalledWith(game, { onError });
    expect(keys).toBe(await watchKeys.mock.results[0]?.value);
    expect(preparePage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("hands a failed scan of the engine to onError and still answers the watcher", async () => {
    const { cli, watchKeys, close } = createCli();
    const broken = "[game] i18n: features/home/strings/en.json could not be read.";
    watchKeys.mockImplementation((_root, watch) => {
      // The engine reports a failed first scan and resolves: the watch goes on.
      watch?.onError?.(broken);
      return Promise.resolve({ close });
    });
    const onError = vi.fn<(message: string) => void>();

    await expect(watchEngineKeys(game, cli, onError)).resolves.toEqual({ close });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(broken);
    expect(close).not.toHaveBeenCalled();
  });

  it("answers the engine's own [game] message when watchKeys rejects or throws", async () => {
    const refused = createCli();
    refused.watchKeys.mockImplementation(() =>
      Promise.reject(new Error("[game] games/timber has no config.ts."))
    );
    await expect(watchEngineKeys(game, refused.cli, vi.fn())).resolves.toBe(
      "[game] games/timber has no config.ts."
    );

    const odd = createCli();
    odd.watchKeys.mockImplementation(() => Promise.reject("plain text"));
    await expect(watchEngineKeys(game, odd.cli, vi.fn())).resolves.toBe("plain text");

    const thrown = createCli();
    thrown.watchKeys.mockImplementation(() => {
      throw new Error("[game] config.ts: page.title must be a string, got 1.");
    });
    await expect(watchEngineKeys(game, thrown.cli, vi.fn())).resolves.toBe(
      "[game] config.ts: page.title must be a string, got 1."
    );
  });
});
