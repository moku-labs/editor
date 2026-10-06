/**
 * @file The temp folders of the root integration wave (plan §2.2): the project root the files
 * plugin serves, the tools page folder pages serves, and the list `shutdown` removes.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The merge-game text styles (`defineTextStyles` from `../../kit`), copied into the tiny project as
 * features/ui/styles.ts: the text-styles file the project index names.
 */
export const STYLES_FIXTURE = new URL(
  "../../../src/plugins/flowView/__tests__/fixtures/ui-styles.txt",
  import.meta.url
).pathname;

/** A markdown file with front matter every tiny project starts with (filesView edits it in F4). */
export const FIRST_NOTE = ".moku/notes/2026-10-01-first-note.md";

/** Every temp folder made in this test file, removed by `removeTemps`. */
const temps: string[] = [];

/**
 * Makes a fresh temp folder and remembers it for `removeTemps`.
 *
 * @param prefix - The folder name prefix.
 * @returns The real path of the folder.
 */
async function makeTemp(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

/**
 * Writes one file, creating its folders.
 *
 * @param root - The base folder.
 * @param relative - The file path under `root`.
 * @param text - The content.
 * @returns Resolves when written.
 */
async function put(root: string, relative: string, text: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/**
 * The small source files of the tiny project, by path. They are never run: the files plugin's
 * project index reads them (amendment N5). The kit hands out `defineFlow`, `defineNode` and
 * `defineTextStyles` from `defineGame()` of "@moku-labs/game", the way a game binds them; the
 * projection and the style import `projection` and `defineStyle` from the package itself. So the
 * index knows `flow:main`, `flow:visit`, `node:main/home`, `node:main/visit`, `node:visit/enter`,
 * `node:visit/leave`, the `textStyle:` keys of features/ui/styles.ts, `projection:tiny.coins` and
 * `style:features/ui/hud.ts#pillStyle`. A node answers the line of its `export const`.
 */
const TINY_SOURCES: Readonly<Record<string, string>> = {
  "kit.ts": [
    "// The authoring helpers of the tiny game, bound once.",
    'import { defineGame } from "@moku-labs/game";',
    "",
    "export const { defineNode, defineFlow, defineTextStyles } = defineGame();",
    ""
  ].join("\n"),
  "nodes/home.ts": [
    "// The rest node of main: the player taps Play.",
    'import { type } from "@moku-labs/game";',
    'import { defineNode } from "../kit";',
    "",
    "export const home = defineNode({",
    "  outcomes: { play: type() },",
    "  rest: true,",
    "  checkpoint: true",
    "});",
    ""
  ].join("\n"),
  "nodes/enter.ts": [
    "// First node of visit: five coins and one visit.",
    'import { type } from "@moku-labs/game";',
    'import { defineNode } from "../kit";',
    "",
    "export const enter = defineNode({",
    "  outcomes: { done: type() },",
    "  run: ({ player, out }) => {",
    "    player.coins += 5;",
    "    player.visits += 1;",
    "    return out.done();",
    "  }",
    "});",
    ""
  ].join("\n"),
  "nodes/leave.ts": [
    "// Last node of visit.",
    'import { type } from "@moku-labs/game";',
    'import { defineNode } from "../kit";',
    "",
    "export const leave = defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });",
    ""
  ].join("\n"),
  "flows/main.ts": [
    "// The top-level flow.",
    'import { defineFlow } from "../kit";',
    'import { home } from "../nodes/home";',
    'import { visit } from "./visit";',
    "",
    'export const mainFlow = defineFlow("main", {',
    "  nodes: { home, visit },",
    '  start: "home",',
    '  edges: { home: { play: "visit" }, visit: { done: "home" } }',
    "});",
    ""
  ].join("\n"),
  "flows/visit.ts": [
    "// The visit sub-flow.",
    'import { exit, type } from "@moku-labs/game";',
    'import { defineFlow } from "../kit";',
    'import { enter } from "../nodes/enter";',
    'import { leave } from "../nodes/leave";',
    "",
    'export const visit = defineFlow("visit", {',
    "  nodes: { enter, leave },",
    '  start: "enter",',
    "  outcomes: { done: type() },",
    '  edges: { enter: { done: "leave" }, leave: { done: exit("done") } }',
    "});",
    ""
  ].join("\n"),
  "view/projections.ts": [
    "// The coin pills: one per five coins.",
    'import { projection } from "@moku-labs/game";',
    "",
    "export const coinPills = projection({",
    '  name: "tiny.coins",',
    '  layer: "hud",',
    "  from: player => Array.from({ length: Math.floor(player.coins / 5) }, (_, slot) => slot),",
    "  key: slot => slot,",
    "  view: () => []",
    "});",
    ""
  ].join("\n"),
  "features/ui/hud.ts": [
    "// The style of a coin pill.",
    'import { defineStyle } from "@moku-labs/game";',
    "",
    'export const pillStyle = defineStyle({ width: 160, height: 48, nineSlice: "ui.hud-pill" });',
    ""
  ].join("\n")
};

/** The two-bundle asset manifest of the tiny project: `manifest.json`, the one the index names. */
export const TINY_MANIFEST = {
  version: 1,
  bundles: {
    ui: {
      tier: "core",
      mb: 1.2,
      files: [
        { key: "ui.hud-pill", path: "hud-pill.webp", width: 1024, height: 1024, mb: 0.61 },
        { key: "ui.font-body", kind: "font", path: "body.woff2", mb: 0.59 }
      ]
    },
    board: {
      tier: "scene",
      mb: 1.728,
      files: [
        { key: "board.board-tray", path: "board-tray.webp", width: 640, height: 631, mb: 1.541 },
        { key: "board.cell", path: "cell.webp", width: 224, height: 219, mb: 0.187 }
      ]
    }
  }
};

/** The text of FIRST_NOTE: front matter, then one line of markdown. */
const FIRST_NOTE_TEXT = [
  "---",
  "title: First note",
  "from:",
  "  node: home",
  "  outcome: play",
  "to: visit",
  "status: idea",
  "captures: []",
  "created: 2026-10-01",
  "---",
  "The tiny game pays five coins per visit.",
  ""
].join("\n");

/**
 * Fills a tiny project root: the kit, node and flow files, a projection, a style, the text styles
 * file, the asset manifest, one markdown file, and two files that must never show in a list
 * (`node_modules/x/index.ts`, `.env`).
 *
 * @param root - The empty project root.
 * @returns Resolves when every file is written.
 */
async function fillTinyProject(root: string): Promise<void> {
  for (const [file, text] of Object.entries(TINY_SOURCES)) await put(root, file, text);
  await put(root, "features/ui/styles.ts", await readFile(STYLES_FIXTURE, "utf8"));
  await put(root, "manifest.json", `${JSON.stringify(TINY_MANIFEST, undefined, 2)}\n`);
  await put(root, FIRST_NOTE, FIRST_NOTE_TEXT);
  await put(root, "node_modules/x/index.ts", "export const x = 1;\n");
  await put(root, ".env", "SECRET=1\n");
}

/**
 * Creates a project root in a fresh temp folder (its real path) and writes the tiny project.
 *
 * @param kind - Which project: `"tiny"`, the only one.
 * @returns The absolute real path of the root.
 */
export async function createProject(kind: "tiny"): Promise<string> {
  const root = await makeTemp(`moku-root-${kind}-`);
  await fillTinyProject(root);
  return root;
}

/** The tools page template: the shape of `TEMPLATE` in the pages plugin tests. */
const PAGE_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>moku editor</title>
    <link rel="stylesheet" crossorigin href="./assets/index.css">
  </head>
  <body><div data-editor-root></div></body>
</html>
`;

/**
 * Creates a built-page folder for pages: `index.html` with `<div data-editor-root>` and two
 * assets (`assets/app.js`, `assets/index.css`).
 *
 * @returns The absolute real path of the folder.
 */
export async function createPageDir(): Promise<string> {
  const dir = await makeTemp("moku-page-");
  await put(dir, "index.html", PAGE_TEMPLATE);
  await put(dir, "assets/app.js", "export {};\n");
  await put(dir, "assets/index.css", "body{margin:0}\n");
  return dir;
}

/**
 * Removes every temp folder made so far in this test file.
 *
 * @returns Resolves when they are gone.
 */
export async function removeTemps(): Promise<void> {
  const dirs = temps.splice(0);
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
}
