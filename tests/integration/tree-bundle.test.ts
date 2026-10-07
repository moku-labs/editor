import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import treeBundle, { createTreeBundle, treeRoot } from "../../scripts/tree/bundle";
import { REPO } from "../fixtures/moku-game";

// ─────────────────────────────────────────────────────────────────────────────
// The editor tree's serve plugin (D-50): a game page that imports
// `@moku-labs/editor/agent/page` bundles it from this tree's dist, and the
// tree's imports of the engine land on the game's own copy. The game root here
// has a physical copy of `@moku-labs/game` of its own (the other packages are
// linked from this repository), so a second engine copy would show in the
// bundle as a renamed duplicate of the engine's `watch`.
// ─────────────────────────────────────────────────────────────────────────────

/** The packages the game root copies instead of linking: the one the page must hold once. */
const ENGINE = path.join("@moku-labs", "game");

/** The page entry: the editor's page agent and the engine functions the agent also uses. */
const ENTRY = `import editorAgent from "@moku-labs/editor/agent/page";
import { read, sources, watch } from "@moku-labs/game/inspect";
console.info(typeof editorAgent, typeof read, typeof sources, typeof watch);
`;

/** A declaration of the engine's `watch`, renamed (`watch2`) when a second copy is bundled. */
const ENGINE_WATCH = /function watch\d*\(/g;

let game: string;
let bundle = "";

/**
 * Fills a game's node_modules: the engine copied, every other package of this repository linked.
 *
 * @param modules - The game's node_modules folder.
 */
async function fillModules(modules: string): Promise<void> {
  const source = path.join(REPO, "node_modules");
  await cp(path.join(source, ENGINE), path.join(modules, ENGINE), { recursive: true });
  for (const name of await readdir(source)) {
    if (name.startsWith(".")) continue;
    if (!name.startsWith("@")) {
      await symlink(path.join(source, name), path.join(modules, name), "dir");
      continue;
    }
    await mkdir(path.join(modules, name), { recursive: true });
    for (const scoped of await readdir(path.join(source, name))) {
      const target = path.join(name, scoped);
      if (target === ENGINE) continue;
      await symlink(path.join(source, target), path.join(modules, target), "dir");
    }
  }
}

beforeAll(async () => {
  game = await realpath(await mkdtemp(path.join(tmpdir(), "moku-tree-bundle-")));
  await fillModules(path.join(game, "node_modules"));
  await writeFile(path.join(game, "main.ts"), ENTRY);

  const result = await Bun.build({
    entrypoints: [path.join(game, "main.ts")],
    target: "browser",
    format: "esm",
    plugins: [createTreeBundle(game)]
  });
  if (!result.success) throw new AggregateError(result.logs, "bundling the page failed");
  const texts = await Promise.all(result.outputs.map(output => output.text()));
  bundle = texts.join("\n");
}, 120_000);

afterAll(async () => {
  await rm(game, { recursive: true, force: true });
});

describe("scripts/tree/bundle.ts (D-50)", () => {
  it("knows its tree: this repository", async () => {
    expect(treeRoot).toBe(await realpath(REPO));
  });

  it("bundles the editor's page agent from the tree's build", () => {
    expect(bundle).toContain("/__editor/hello");
    expect(bundle).toContain("editor.capture");
    expect(bundle).toContain("dist/agent-page.mjs");
  });

  it("holds one copy of the engine: the tree's imports land on the game's copy", () => {
    expect(bundle.match(ENGINE_WATCH)).toHaveLength(1);
    expect(bundle).not.toContain(path.join(REPO, "node_modules", ENGINE));
  });

  it("default-exports the plugin the engine page loads, for the cwd of the serving bin", () => {
    expect(treeBundle.name).toBe("moku-editor-tree");
    expect(typeof treeBundle.setup).toBe("function");
  });
});
