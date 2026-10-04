/**
 * @file The Files workspace (spec 16-filesView) in a real browser, on the frozen merge-game: the
 * project tree (count, click, the keys ↑/↓/←/→/Home/End/Enter, Refresh picking up a file created
 * on disk), ⌘K "go to file", tabs (several, activate, ←/→, close, middle click, the discard
 * popover of a modified tab), the code view with colour for TS, CSS and JSON, the Markdown preview
 * with its front matter as raw text, the image preview of a capture PNG, the series card that
 * opens the contact sheet in Game, edit mode (Cancel, Esc, ⌘S, Save), the version conflict with
 * Reload and Overwrite, a game source save that reloads the game and restores its state (D-07),
 * the "Used by" chips that jump to the Flow node, the editor link, "file too large" and the
 * sandbox. Below 600 px the tree is a drawer that starts collapsed and shuts when a file opens: a
 * test opens it before it works in the tree.
 *
 * Every file this spec writes lives in `e2e-files/` or `.moku/captures/` of the served copy
 * (dist-e2e/game) and is removed after each test; a game source the D-07 test edits is restored.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";

/** The served game root. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The folder of this spec's own files, relative to the root. */
const DIR = "e2e-files";

/** The captures folder of gameView. */
const CAPTURES = ".moku/captures";

/** The capture PNG this spec writes. */
const SHOT = `${CAPTURES}/e2e-shot.png`;

/** The series folder this spec writes. */
const SERIES = `${CAPTURES}/series-e2e`;

/** Game-frame warnings a reload provokes that are not editor defects (see game.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** The files the allow list of the files plugin lists. */
const ALLOWED = /\.(ts|tsx|json|md|css)$/;

/** The CSS sample. */
const CSS_TEXT = ["/* e2e */", "[data-e2e] {", "  color: red;", "  margin: 4px;", "}", ""].join(
  "\n"
);

/** The JSON sample. */
const JSON_TEXT = `${JSON.stringify({ name: "e2e", count: 3, on: true }, undefined, 2)}\n`;

/** The lines of the front matter of the Markdown sample. */
const FRONT_MATTER = ["title: e2e doc", "status: idea", "captures:", `  - ${SHOT}`];

/** The Markdown sample: a front matter, a body with a heading, a list, links and a fence. */
const DOC_TEXT = [
  "---",
  ...FRONT_MATTER,
  "---",
  "# Heading one",
  "",
  "Some **bold** text and a [web link](https://example.com).",
  "",
  "- first item",
  "- second item",
  "",
  "[outside](outside.md) and [up](../../../package.json)",
  "",
  "```ts",
  "const a = 1;",
  "```",
  ""
].join("\n");

/** The plain Markdown file the edit tests change. */
const PLAIN_TEXT = ["# Plain", "", "line two", ""].join("\n");

// ---------------------------------------------------------------------------------------------
// Disk helpers
// ---------------------------------------------------------------------------------------------

/**
 * The absolute path of a root-relative file.
 *
 * @param file - Root-relative path.
 * @returns The absolute path.
 */
function abs(file: string): string {
  return path.join(GAME_ROOT, file);
}

/**
 * Writes a root-relative file, creating its folder.
 *
 * @param file - Root-relative path.
 * @param body - The content.
 */
async function put(file: string, body: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(abs(file)), { recursive: true });
  await writeFile(abs(file), body);
}

/**
 * Reads a root-relative file.
 *
 * @param file - Root-relative path.
 * @returns The text, undefined when missing.
 */
async function readGameFile(file: string): Promise<string | undefined> {
  return existsSync(abs(file)) ? readFile(abs(file), "utf8") : undefined;
}

/** The CRC-32 table of the PNG chunks. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/**
 * The CRC-32 of bytes.
 *
 * @param bytes - The bytes.
 * @returns The CRC.
 */
function crc32(bytes: Uint8Array): number {
  let c = 0xff_ff_ff_ff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

/**
 * One PNG chunk.
 *
 * @param type - The four-letter type.
 * @param data - The data.
 * @returns The chunk bytes.
 */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A solid RGB PNG.
 *
 * @param w - Width.
 * @param h - Height.
 * @param rgb - The colour.
 * @returns The file bytes.
 */
function png(w: number, h: number, rgb: readonly [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: w }, () => rgb).flat())
  ]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/**
 * Counts the files the tree lists: every allowed file outside node_modules, plus everything
 * under .moku/.
 *
 * @param folder - Root-relative folder.
 * @returns The count.
 */
async function countFiles(folder = ""): Promise<number> {
  let count = 0;
  for (const entry of await readdir(abs(folder), { withFileTypes: true })) {
    const rel = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) count += await countFiles(rel);
    else if (ALLOWED.test(rel) || rel.startsWith(".moku/")) count += 1;
  }
  return count;
}

/**
 * Removes every file of this spec.
 */
async function clean(): Promise<void> {
  await rm(abs(DIR), { recursive: true, force: true });
  await rm(abs(SHOT), { force: true });
  await rm(abs(SERIES), { recursive: true, force: true });
}

test.beforeEach(async () => {
  await clean();
  await put(`${DIR}/sample.css`, CSS_TEXT);
  await put(`${DIR}/sample.json`, JSON_TEXT);
  await put(`${DIR}/doc.md`, DOC_TEXT);
  await put(`${DIR}/plain.md`, PLAIN_TEXT);
  // A symlink that leaves the root: the sandbox hides it and refuses to read it.
  await symlink(fileURLToPath(new URL("../README.md", import.meta.url)), abs(`${DIR}/outside.md`));
  await put(SHOT, png(40, 30, [200, 40, 40]));
});

test.afterEach(async () => {
  await clean();
});

// ---------------------------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------------------------

/**
 * The Files workspace host.
 *
 * @param page - The test page.
 * @returns The host.
 */
function files(page: Page): Locator {
  return page.locator("[data-workspace-host=files]");
}

/**
 * A tree row by path.
 *
 * @param page - The test page.
 * @param rel - Root-relative path.
 * @returns The row.
 */
function row(page: Page, rel: string): Locator {
  return files(page).locator(`[role=treeitem][data-path="${rel}"]`);
}

/**
 * A tab button by path.
 *
 * @param page - The test page.
 * @param rel - Root-relative path.
 * @returns The tab.
 */
function tab(page: Page, rel: string): Locator {
  return files(page).locator(`[role=tab][title="${rel}"]`);
}

/**
 * The paths of the open tabs, in order.
 *
 * @param page - The test page.
 * @returns The paths.
 */
async function tabPaths(page: Page): Promise<string[]> {
  const titles = await files(page)
    .locator("[role=tab]")
    .evaluateAll(tabs => tabs.map(element => element.getAttribute("title") ?? ""));
  return titles;
}

/**
 * The path of the focused tree row, "" when focus is elsewhere.
 *
 * @param page - The test page.
 * @returns The path.
 */
async function focusedRow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    return element instanceof HTMLElement && element.getAttribute("role") === "treeitem"
      ? (element.dataset.path ?? "")
      : "";
  });
}

/**
 * Starts recording every toast, in order (see game.spec.ts).
 *
 * @param page - The test page.
 */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = new WeakSet<Element>();
    const history: string[] = [];
    Reflect.set(globalThis, "__e2eToasts", history);
    const scan = (): void => {
      for (const element of document.querySelectorAll("[data-ui=toasts] [data-toast]")) {
        if (seen.has(element)) continue;
        seen.add(element);
        history.push(element.textContent ?? "");
      }
    };
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * The toasts since `recordToasts`.
 *
 * @param page - The test page.
 * @returns The texts.
 */
async function toastHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((Reflect.get(globalThis, "__e2eToasts") as string[]) ?? [])]);
}

/**
 * Shows the tree: below 600 px it is a drawer that starts collapsed and shuts when a file opens,
 * so its rail button opens it; docked it already shows.
 *
 * @param page - The test page.
 */
async function openTree(page: Page): Promise<void> {
  const panel = files(page).locator('aside[data-side-panel="files.tree"]');
  await expect(panel).toBeVisible();
  // The panel settles into drawer mode once its container is measured.
  await expect
    .poll(() =>
      panel.evaluate(element => {
        const width = element.parentElement?.getBoundingClientRect().width ?? 0;
        const isDrawer = element.dataset.overlay !== undefined;
        return width > 0 && width < 600 === isDrawer;
      })
    )
    .toBe(true);
  if ((await panel.getAttribute("data-state")) === "collapsed") {
    await panel.locator(":scope > [data-part=rail] [data-action=expand]").click();
  }
  await expect(panel).toHaveAttribute("data-state", "expanded");
}

/**
 * Shows Files and waits for the tree.
 *
 * @param tools - The driver.
 */
async function showFiles(tools: Tools): Promise<void> {
  await tools.show("files");
  await openTree(tools.page);
  await expect(files(tools.page).locator("[role=tree]")).toBeVisible();
}

/**
 * Opens a file through the tree, expanding every ancestor folder first.
 *
 * @param page - The test page.
 * @param rel - Root-relative path.
 */
async function openInTree(page: Page, rel: string): Promise<void> {
  await openTree(page);
  const parts = rel.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const folder = row(page, parts.slice(0, index).join("/"));
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
    await expect(folder).toHaveAttribute("aria-expanded", "true");
  }
  await row(page, rel).click();
  await expect(tab(page, rel)).toHaveAttribute("aria-selected", "true");
}

/**
 * Opens a file with ⌘K "go to file".
 *
 * @param page - The test page.
 * @param query - What to type.
 * @param rel - The file it must open.
 */
async function goToFile(page: Page, query: string, rel: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator("dialog[data-ui=palette]");
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search" }).fill(query);
  await palette
    .getByRole("option", { name: new RegExp(rel.replaceAll(".", String.raw`\.`)) })
    .first()
    .click();
  await expect(palette).toBeHidden();
  await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "files");
  await expect(tab(page, rel)).toHaveAttribute("aria-selected", "true");
}

/**
 * The file body.
 *
 * @param page - The test page.
 * @returns The body.
 */
function body(page: Page): Locator {
  return files(page).locator("[data-files-body]");
}

/**
 * The file bar.
 *
 * @param page - The test page.
 * @returns The bar.
 */
function fileBar(page: Page): Locator {
  return files(page).locator("[data-part=file-bar]");
}

/**
 * The game page frame.
 *
 * @param page - The test page.
 * @returns The frame.
 */
function gameFrame(page: Page): Frame {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

/**
 * The game position path, "pending" while the game page reloads.
 *
 * @param page - The test page.
 * @returns The path.
 */
async function gamePath(page: Page): Promise<string> {
  try {
    return await gameFrame(page).evaluate(async () => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { source(id: string): { read(input: object): Promise<{ path: string }> } };
        }
      ).registry;
      const position = await registry.source("game.position").read({});
      return position.path;
    });
  } catch {
    return "pending";
  }
}

/**
 * Taps a keyed game element with the real mouse on the game canvas.
 *
 * @param page - The test page.
 * @param key - The ui key.
 */
async function tapGame(page: Page, key: string): Promise<void> {
  const readRect = (): Promise<{ x: number; y: number; w: number; h: number } | null> =>
    gameFrame(page).evaluate(async uiKey => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: {
            source(id: string): {
              read(input: object): Promise<{ x: number; y: number; w: number; h: number } | null>;
            };
          };
        }
      ).registry;
      return registry.source("game.rect").read({ key: uiKey });
    }, key);
  await expect.poll(async () => (await readRect()) !== null).toBe(true);
  const rect = await readRect();
  const box = await page.locator("iframe").first().boundingBox();
  if (rect === null || box === null) throw new Error("no rect");
  const scale = box.width / (await gameFrame(page).evaluate(() => innerWidth));
  await page.mouse.click(
    box.x + (rect.x + rect.w / 2) * scale,
    box.y + (rect.y + rect.h / 2) * scale
  );
}

/**
 * Shows Game and waits for the frame to dock over the stage slot (see state.spec.ts).
 *
 * @param tools - The driver.
 */
async function showGame(tools: Tools): Promise<void> {
  const page = tools.page;
  await tools.show("game");
  await expect
    .poll(async () => {
      const slot = await tools.host("game").locator("[data-part=slot]").boundingBox();
      const frame = await page.locator("iframe").first().boundingBox();
      return slot !== null && frame !== null && Math.abs(slot.x - frame.x) < 1;
    })
    .toBe(true);
}

/**
 * Tells whether the game page was reloaded since it was marked.
 *
 * @param page - The test page.
 * @returns "reloaded", "marked" or "pending".
 */
async function reloadState(page: Page): Promise<string> {
  try {
    return await gameFrame(page).evaluate(() =>
      Reflect.get(globalThis, "__e2eMark") === 1 ? "marked" : "reloaded"
    );
  } catch {
    return "pending";
  }
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test.describe("files · tree", () => {
  test("the empty editor, the file count, click expand and collapse, and Refresh picks up a new file", async ({
    tools
  }) => {
    const page = tools.page;
    await showFiles(tools);
    const head = files(page).locator("[data-tree-head] span");
    await expect(head).toHaveText(`Project · ${await countFiles()} files`);
    await expect(files(page).locator("[data-empty]")).toHaveText(
      "Pick a file in the tree, or press ⌘K and type a file name."
    );

    // Folders are closed at first; a click opens and closes one.
    const nodes = row(page, "nodes");
    await expect(nodes).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "nodes/merge.ts")).toHaveCount(0);
    await nodes.click();
    await expect(nodes).toHaveAttribute("aria-expanded", "true");
    await expect(nodes.locator("[data-twisty]")).toHaveText("▾");
    await expect(row(page, "nodes/merge.ts")).toBeVisible();
    await expect(row(page, "nodes/merge.ts")).toHaveAttribute("aria-level", "2");
    await expect(row(page, "nodes/merge.ts").locator("[data-glyph]")).toHaveAttribute(
      "data-glyph",
      "ts"
    );
    await nodes.click();
    await expect(nodes).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "nodes/merge.ts")).toHaveCount(0);

    // A file created on disk shows after Refresh, and the count follows.
    const before = await countFiles();
    await put(`${DIR}/added-later.md`, "# added\n");
    await row(page, DIR).click();
    await expect(row(page, `${DIR}/added-later.md`)).toHaveCount(0);
    await files(page).getByRole("button", { name: "Refresh the file list" }).click();
    await expect(row(page, `${DIR}/added-later.md`)).toBeVisible();
    await expect(head).toHaveText(`Project · ${before + 1} files`);
  });

  test("keys: ↓/↑ move, → opens then enters, ← leaves then closes, Home/End, Enter opens a file", async ({
    tools
  }) => {
    const page = tools.page;
    await showFiles(tools);
    const rows = files(page).locator("[role=treeitem]");
    const paths = await rows.evaluateAll(items => items.map(item => item.dataset.path));
    const flowsAt = paths.indexOf("flows");
    expect(flowsAt).toBeGreaterThan(0);

    await row(page, "flows").focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedRow(page)).toBe(paths[flowsAt + 1]);
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => focusedRow(page)).toBe("flows");

    await page.keyboard.press("ArrowRight");
    await expect(row(page, "flows")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => focusedRow(page)).toBe("flows");
    const children = await files(page)
      .locator("[role=treeitem][aria-level='2']")
      .evaluateAll(items => items.map(item => item.dataset.path));
    expect(children).toEqual(["flows/board.ts", "flows/main.ts", "flows/reward.ts"]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focusedRow(page)).toBe("flows/board.ts");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedRow(page)).toBe("flows/main.ts");

    // ← on a file goes to its folder; ← on an open folder closes it.
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => focusedRow(page)).toBe("flows");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "flows")).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("End");
    await expect.poll(() => focusedRow(page)).toBe(paths.at(-1) ?? "");
    await page.keyboard.press("Home");
    await expect.poll(() => focusedRow(page)).toBe(paths[0] ?? "");

    // Enter on a folder toggles it, Enter on a file opens it in a tab.
    for (let step = 0; step < flowsAt; step += 1) {
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => focusedRow(page)).toBe(paths[step + 1]);
    }
    await page.keyboard.press("Enter");
    await expect(row(page, "flows")).toHaveAttribute("aria-expanded", "true");
    await row(page, "flows/main.ts").focus();
    await page.keyboard.press("Enter");
    await expect(tab(page, "flows/main.ts")).toHaveAttribute("aria-selected", "true");
    await expect(row(page, "flows/main.ts")).toHaveAttribute("aria-selected", "true");
    await expect(fileBar(page).locator("[data-crumb-file]")).toHaveText("main.ts");

    // The crumb's folder reveals and focuses the folder row.
    await fileBar(page).locator("[data-crumb-folder]", { hasText: "flows" }).click();
    await expect.poll(() => focusedRow(page)).toBe("flows");
  });

  test("⌘K goes to a file from another workspace; the Files group lists every file", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    await goToFile(page, "sample.css", `${DIR}/sample.css`);
    await expect(body(page).locator("[data-part=code-view]")).toBeVisible();
    // Opening reveals the file in the tree.
    await expect(row(page, `${DIR}/sample.css`)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator("dialog[data-ui=palette]");
    await palette.getByRole("combobox", { name: "Search" }).fill("merge.ts");
    await expect(palette.getByRole("option", { name: /nodes\/merge\.ts/ })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });
});

test.describe("files · tabs", () => {
  test("several tabs: activate by click and ←/→, close with ×, middle click closes", async ({
    tools
  }) => {
    const page = tools.page;
    await showFiles(tools);
    await openInTree(page, "nodes/merge.ts");
    await openInTree(page, "flows/board.ts");
    await openInTree(page, "game.ts");
    expect(await tabPaths(page)).toEqual(["nodes/merge.ts", "flows/board.ts", "game.ts"]);
    await expect(tab(page, "game.ts")).toHaveText("game.ts");

    await tab(page, "nodes/merge.ts").click();
    await expect(tab(page, "nodes/merge.ts")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "game.ts")).toHaveAttribute("aria-selected", "false");
    await expect(fileBar(page).locator("[data-crumb-file]")).toHaveText("merge.ts");

    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "flows/board.ts")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "flows/board.ts")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "nodes/merge.ts")).toHaveAttribute("aria-selected", "true");

    // Reopening an open file activates its tab, no duplicate.
    await openTree(page);
    await row(page, "game.ts").click();
    expect(await tabPaths(page)).toEqual(["nodes/merge.ts", "flows/board.ts", "game.ts"]);
    await expect(tab(page, "game.ts")).toHaveAttribute("aria-selected", "true");

    await files(page).getByRole("button", { name: "Close game.ts", exact: true }).click();
    expect(await tabPaths(page)).toEqual(["nodes/merge.ts", "flows/board.ts"]);
    await expect(tab(page, "flows/board.ts")).toHaveAttribute("aria-selected", "true");

    await tab(page, "nodes/merge.ts").click({ button: "middle" });
    expect(await tabPaths(page)).toEqual(["flows/board.ts"]);
    await files(page).getByRole("button", { name: "Close board.ts", exact: true }).click();
    await expect(files(page).locator("[role=tab]")).toHaveCount(0);
    await expect(files(page).locator("[data-empty]")).toBeVisible();
  });

  test("a modified tab shows the dot; closing it asks Discard / Keep", async ({ tools }) => {
    const page = tools.page;
    await showFiles(tools);
    await openInTree(page, `${DIR}/plain.md`);
    await fileBar(page).getByRole("button", { name: "Edit here" }).click();
    await files(page)
      .getByRole("textbox", { name: `Edit ${DIR}/plain.md` })
      .fill("# changed\n");
    const close = files(page).getByRole("button", { name: "Close plain.md · modified" });
    await expect(close).toHaveAttribute("data-modified", "");

    await close.click();
    const discard = files(page).locator("[data-discard]");
    await expect(discard).toBeVisible();
    await expect(discard.locator("p")).toHaveText("Discard changes to plain.md?");
    await discard.getByRole("button", { name: "Keep" }).click();
    await expect(discard).toHaveCount(0);
    expect(await tabPaths(page)).toEqual([`${DIR}/plain.md`]);

    await tab(page, `${DIR}/plain.md`).click({ button: "middle" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Discard" }).click();
    await expect(files(page).locator("[role=tab]")).toHaveCount(0);
    expect(await readGameFile(`${DIR}/plain.md`)).toBe(PLAIN_TEXT);
  });
});

test.describe("files · views", () => {
  test("code view colours TS, CSS and JSON; the editor link and the line numbers", async ({
    tools
  }) => {
    const page = tools.page;
    await showFiles(tools);
    const code = body(page).locator("[data-part=code-view]");

    await openInTree(page, "nodes/merge.ts");
    const source = (await readGameFile("nodes/merge.ts")) ?? "";
    await expect(code.locator("[data-line]").first()).toHaveAttribute("data-line", "1");
    await expect(code.locator("[data-token=keyword]").first()).toBeVisible();
    await expect(
      code.locator("[data-token=keyword]", { hasText: /^import$/ }).first()
    ).toBeVisible();
    await expect(code.locator("[data-token=string]").first()).toBeVisible();
    expect(source.split("\n").length).toBeGreaterThan(5);

    // Open in editor: vscode://file/<root>/<path>:<line>.
    const root = GAME_ROOT.replace(/\/$/, "");
    const link = fileBar(page).getByRole("link", { name: "Open in editor" });
    await expect(link).toHaveAttribute(
      "href",
      `vscode://file${encodeURI(path.join(root, "nodes/merge.ts"))}:1`
    );

    await openInTree(page, `${DIR}/sample.css`);
    await expect(code.locator("[data-line]")).toHaveCount(CSS_TEXT.split("\n").length);
    await expect(code.locator("[data-token=comment]").first()).toHaveText("/* e2e */");
    await expect(code.locator("[data-token]").first()).toBeVisible();
    await expect(code.locator("[data-line='3']")).toContainText("color: red;");

    await openInTree(page, `${DIR}/sample.json`);
    await expect(code.locator("[data-token=string]", { hasText: '"e2e"' })).toBeVisible();
    await expect(code.locator("[data-token=number]", { hasText: "3" })).toBeVisible();
    // A file outside a flow has no Used by.
    await expect(files(page).locator("[data-part=used-by] [data-muted]")).toHaveText(
      "Used by · no node or flow"
    );
  });

  test("Markdown preview: the front matter as raw text, headings, lists, links; Source shows the code", async ({
    tools
  }) => {
    const page = tools.page;
    await showFiles(tools);
    await openInTree(page, `${DIR}/doc.md`);
    const preview = body(page).locator("[data-preview=markdown]");
    await expect(preview).toBeVisible();
    // The front matter is one plain block of its raw lines: nothing parsed, nothing to click.
    const front = preview.locator("pre[data-front-matter]");
    await expect(front).toHaveText(FRONT_MATTER.join("\n"));
    await expect(front.locator("button, a")).toHaveCount(0);
    await expect(preview.locator("[data-md] h1")).toHaveText("Heading one");
    await expect(preview.locator("[data-md] li")).toHaveText(["first item", "second item"]);
    await expect(preview.locator("[data-md] strong")).toHaveText("bold");
    await expect(preview.getByRole("link", { name: "web link" })).toHaveAttribute(
      "href",
      "https://example.com"
    );
    await expect(preview.locator("[data-md-code]")).toContainText("const a = 1;");
    // No markup leaks: the front matter is not shown again in the body.
    await expect(preview.locator("[data-md]")).not.toContainText("title:");

    const modes = fileBar(page).getByRole("radiogroup", { name: "View" });
    await expect(modes.getByRole("radio", { name: "Preview" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await modes.getByRole("radio", { name: "Source" }).click();
    await expect(modes.getByRole("radio", { name: "Source" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(body(page).locator("[data-part=code-view] [data-line='1']")).toHaveText(/---/);
    await modes.getByRole("radio", { name: "Preview" }).click();
    await expect(front).toBeVisible();
  });

  test("image preview: the capture PNG, its size caption and the fit / 100 % toggle", async ({
    tools
  }) => {
    const page = tools.page;
    await showFiles(tools);
    await openInTree(page, SHOT);
    const figure = body(page).locator("[data-preview=image]");
    const img = figure.locator("img");
    await expect(img).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(40);
    const { size } = await stat(abs(SHOT));
    await expect(figure.locator("figcaption")).toHaveText(
      `40×30 · ${Math.max(1, Math.round(size / 1024))} KB · ${SHOT}`
    );
    const toggle = figure.locator("[data-image-toggle]");
    await expect(figure).toHaveAttribute("data-fit", "fit");
    await toggle.click();
    await expect(figure).toHaveAttribute("data-fit", "actual");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(figure).toHaveAttribute("data-fit", "fit");
    // An image has no Edit here.
    await expect(fileBar(page).getByRole("button", { name: "Edit here" })).toHaveCount(0);
  });

  test("series index.json: the card summary, Source, and Open contact sheet shows it in Game", async ({
    tools
  }) => {
    const page = tools.page;
    const index = {
      durationMs: 500,
      intervalMs: 250,
      fromFrame: 10,
      device: { name: "iPhone 15", orientation: "portrait", w: 393, h: 852 },
      shots: [
        { file: "001.png", frame: 10, atMs: 0 },
        { file: "002.png", frame: 25, atMs: 250, bug: true }
      ]
    };
    await put(`${SERIES}/001.png`, png(30, 60, [40, 200, 40]));
    await put(`${SERIES}/002.png`, png(30, 60, [40, 40, 200]));
    await put(`${SERIES}/index.json`, `${JSON.stringify(index, undefined, 2)}\n`);
    await showFiles(tools);
    await files(page).getByRole("button", { name: "Refresh the file list" }).click();
    await openInTree(page, `${SERIES}/index.json`);
    const card = body(page).locator("[data-preview=series]");
    await expect(card.locator("p")).toHaveText(
      "Series · series-e2e · 2 shots · 0.5 s at 250 ms · from frame 10"
    );
    await expect(card.locator("[data-tag=warn]")).toHaveText("1 marked as bug");
    await expect(body(page).locator("[data-part=code-view]")).toHaveCount(0);
    const modes = fileBar(page).getByRole("radiogroup", { name: "View" });
    await modes.getByRole("radio", { name: "Source" }).click();
    await expect(body(page).locator("[data-part=code-view]")).toContainText('"durationMs": 500');

    await card.getByRole("button", { name: "Open contact sheet" }).click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "game");
    const sheet = page.locator("dialog[data-game=sheet]");
    await expect(sheet).toBeVisible();
    // The index has no label: the sheet names the series by its folder, as the Files card does.
    await expect(sheet.getByRole("heading")).toHaveText(/^Series · series-e2e · 2 shots · /);
    await expect(sheet.locator("[data-part=tile]")).toHaveCount(2);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("too large: a file over 2 MB shows the message and the editor link", async ({
    tools,
    errors
  }) => {
    errors.allow(/event: filesView:read-failed/);
    const page = tools.page;
    await put(`${DIR}/huge.md`, "x".repeat(2 * 1024 * 1024 + 10));
    await showFiles(tools);
    await files(page).getByRole("button", { name: "Refresh the file list" }).click();
    await openInTree(page, `${DIR}/huge.md`);
    const error = body(page).locator("[data-body-state=error]");
    await expect(error).toContainText("File too large to open here (over 2 MB)");
    await expect(error.getByRole("link", { name: "Open in editor" })).toHaveAttribute(
      "href",
      /^vscode:\/\/file\/.+\/e2e-files\/huge\.md:1$/
    );
  });

  test("sandbox: a symlink out of the root is hidden and refused; ../ links stay inside the root", async ({
    tools,
    errors
  }) => {
    errors.allow(/event: filesView:read-failed/);
    const page = tools.page;
    await showFiles(tools);
    await row(page, DIR).click();
    await expect(row(page, `${DIR}/doc.md`)).toBeVisible();
    await expect(row(page, `${DIR}/outside.md`)).toHaveCount(0);

    await row(page, `${DIR}/doc.md`).click();
    const md = body(page).locator("[data-md]");
    await md.getByRole("button", { name: "outside" }).click();
    await expect(tab(page, `${DIR}/outside.md`)).toHaveAttribute("aria-selected", "true");
    await expect(body(page).locator("[data-body-state=error]")).toHaveText(
      "This file is outside the editor's sandbox."
    );

    // "../../../package.json" from e2e-files/ is clamped to the root: the game's own package.json.
    await tab(page, `${DIR}/doc.md`).click();
    await md.getByRole("button", { name: "up" }).click();
    await expect(tab(page, "package.json")).toHaveAttribute("aria-selected", "true");
    await expect(body(page).locator("[data-part=code-view]")).toContainText("merge-game-e2e");
    await expect(body(page).locator("[data-part=code-view]")).not.toContainText(
      "@moku-labs/editor"
    );
  });
});

test.describe("files · edit and save", () => {
  test("Edit here, Cancel, Esc, then Save and ⌘S write the file on disk", async ({ tools }) => {
    const page = tools.page;
    const rel = `${DIR}/plain.md`;
    await showFiles(tools);
    await openInTree(page, rel);
    await fileBar(page).getByRole("radio", { name: "Source" }).click();
    const edit = fileBar(page).getByRole("button", { name: "Edit here" });
    const area = files(page).getByRole("textbox", { name: `Edit ${rel}` });
    const save = fileBar(page).getByRole("button", { name: "Save ⌘S" });

    // Cancel drops the buffer.
    await edit.click();
    await expect(area).toHaveValue(PLAIN_TEXT);
    await expect(save).toBeDisabled();
    await area.fill("# dropped\n");
    await expect(save).toBeEnabled();
    await fileBar(page).getByRole("button", { name: "Cancel" }).click();
    await expect(area).toHaveCount(0);
    await expect(body(page).locator("[data-part=code-view] [data-line='1']")).toHaveText(/# Plain/);

    // Esc leaves edit mode.
    await edit.click();
    await area.focus();
    await page.keyboard.press("Escape");
    await expect(area).toHaveCount(0);
    await expect(edit).toBeVisible();

    // Save writes the buffer and toasts the file.
    await recordToasts(page);
    await edit.click();
    await area.fill("# saved once\n");
    await expect(files(page).locator("[data-close][data-modified]")).toHaveCount(1);
    await save.click();
    await expect.poll(() => readGameFile(rel)).toBe("# saved once\n");
    await expect.poll(() => toastHistory(page)).toContain(`✓ Saved · ${rel}`);
    await expect(files(page).locator("[data-close][data-modified]")).toHaveCount(0);
    await expect(save).toBeDisabled();

    // ⌘S inside the textarea saves too; Tab indents.
    await area.fill("# saved twice\n");
    await area.press("End");
    await area.press("Tab");
    await expect(area).toHaveValue("# saved twice\n  ");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => readGameFile(rel)).toBe("# saved twice\n  ");
  });

  test("a stale version shows the conflict bar: Reload takes the disk, Overwrite writes the buffer", async ({
    tools
  }) => {
    const page = tools.page;
    const rel = `${DIR}/plain.md`;
    await showFiles(tools);
    await openInTree(page, rel);
    await fileBar(page).getByRole("radio", { name: "Source" }).click();
    await fileBar(page).getByRole("button", { name: "Edit here" }).click();
    const area = files(page).getByRole("textbox", { name: `Edit ${rel}` });
    const save = fileBar(page).getByRole("button", { name: "Save ⌘S" });
    const conflict = fileBar(page).locator("[data-conflict]");

    await area.fill("# mine\n");
    await put(rel, "# theirs\n");
    await save.click();
    await expect(conflict).toHaveText("The file changed on disk · Reload / Overwrite");
    await expect(conflict).toHaveAttribute("role", "alert");
    await conflict.getByRole("button", { name: "Reload" }).click();
    await expect(conflict).toHaveCount(0);
    expect(await readGameFile(rel)).toBe("# theirs\n");
    await expect(body(page)).toContainText("# theirs");

    if ((await area.count()) === 0)
      await fileBar(page).getByRole("button", { name: "Edit here" }).click();
    await area.fill("# mine again\n");
    await put(rel, "# theirs again\n");
    await save.click();
    await expect(conflict).toBeVisible();
    await conflict.getByRole("button", { name: "Overwrite" }).click();
    await expect(conflict).toHaveCount(0);
    await expect.poll(() => readGameFile(rel)).toBe("# mine again\n");
  });

  test("saving a game source reloads the game and restores its state (D-07)", async ({
    tools,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    const rel = "nodes/merge.ts";
    const original = (await readGameFile(rel)) ?? "";
    // The frame docks over the stage after Game shows: a tap measured before that misses Play.
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    await tapGame(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
    try {
      await showFiles(tools);
      await openInTree(page, rel);
      await fileBar(page).getByRole("button", { name: "Edit here" }).click();
      const area = files(page).getByRole("textbox", { name: `Edit ${rel}` });
      await area.fill(`${original}// e2e save\n`);
      await gameFrame(page).evaluate(() => Reflect.set(globalThis, "__e2eMark", 1));
      await recordToasts(page);
      await page.keyboard.press("ControlOrMeta+s");
      await expect.poll(() => readGameFile(rel)).toBe(`${original}// e2e save\n`);
      // Bun hot reload reloads the page and the bridge restores its checkpoint (D-23): one
      // reload, one toast, and the editor does not restore a second time.
      await expect
        .poll(() => toastHistory(page), { timeout: 30_000 })
        .toEqual([`✓ Saved · ${rel}`, "Game reloaded · state restored"]);
      await expect.poll(() => reloadState(page), { timeout: 30_000 }).toBe("reloaded");
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
        timeout: 30_000
      });
      await expect.poll(() => gamePath(page), { timeout: 30_000 }).toBe("board/awaitIntent");
    } finally {
      await writeFile(abs(rel), original);
    }
  });
});

test.describe("files · used by", () => {
  test("node and flow chips jump to the Flow node; .moku files show no row", async ({ tools }) => {
    const page = tools.page;
    await showFiles(tools);
    await openInTree(page, "nodes/merge.ts");
    const usedBy = files(page).locator("[data-part=used-by]");
    await expect(usedBy.locator("[data-label]")).toHaveText("Used by");
    const nodeChip = usedBy.locator("[data-chip][data-kind=node]", { hasText: "board/merge" });
    await expect(nodeChip).toBeVisible();
    await nodeChip.click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "flow");
    const flowHost = page.locator("[data-workspace-host=flow]");
    await expect(
      flowHost.locator('[data-flow=node-card][aria-label="board/merge"]')
    ).toHaveAttribute("data-selected", "");

    await showFiles(tools);
    await openInTree(page, "flows/board.ts");
    const flowChip = usedBy.locator("[data-chip][data-kind=flow]");
    await expect(flowChip).toHaveText("flow board");
    await flowChip.click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "flow");
    // The flow chip selects the flow's start node, board/awaitIntent.
    await expect(
      flowHost.locator('[data-selected][aria-label="board/awaitIntent"]')
    ).toHaveAttribute("aria-pressed", "true");

    await showFiles(tools);
    await openInTree(page, SHOT);
    await expect(usedBy).toHaveCount(0);
  });
});
