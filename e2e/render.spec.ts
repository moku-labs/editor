/**
 * @file The Render workspace (spec 14-renderView) in a real browser, on the frozen merge-game: the
 * six metric tiles against the game's own `game.render`, `game.assets` and `game.effects` values
 * and the page heap Chromium reports, the FPS sparkline (with the rest note at 30 fps) and the
 * frame bar, the render tree (Expand all, Collapse, twisties, the keys ←/→/↑/↓/Enter and the
 * inline detail), the pink box a hovered row draws over the game frame at the element's real
 * rect, "Inspect in Game", the textures table (bundle chips, every column sorted both ways, use
 * tags), the Bundles, Pools and Release log cards, Refresh, the palette's Textures items and the
 * workspace scrolling inside its own area.
 *
 * Ground truth is read from the game page itself: the registry the editor agent exposes there
 * (`globalThis.editor`) answers the same sources the tools page watches.
 */
import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The asset manifest the Textures card reads. */
const MANIFEST = path.join(GAME_ROOT, "manifest.json");

/** Where Refresh's test parks the manifest. */
const MANIFEST_AWAY = path.join(GAME_ROOT, "manifest.e2e-away.json");

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** `game.render` of game 0.1.0 in a dev build. */
type RenderStats = {
  readonly fps: number;
  readonly frameMs: number;
  readonly textures: number;
  readonly textureMb: number;
  readonly views: number;
  readonly pooled: number;
  readonly renderPasses?: number;
  readonly drawCalls?: number;
};

/** `game.effects`. */
type EffectsStats = {
  readonly particles: number;
  readonly emitters: number;
  readonly filters: number;
};

/** `game.assets`. */
type AssetsUsage = {
  readonly textureMb: number;
  readonly budgetMb: number;
  readonly bundles: readonly {
    readonly name: string;
    readonly tier: string;
    readonly mb: number;
  }[];
};

/** The FPS sub line while the newest sample sits at the game's idle rate (D-28). */
const RESTING = "Resting at 30 fps: nothing moved for 2 s (game time.idleFps)";

/** One texture row as the table shows it. */
type TextureCells = {
  readonly key: string;
  readonly bundle: string;
  readonly size: string;
  readonly gpuMb: string;
  readonly fileMb: string;
  readonly use: string;
  readonly data: string;
};

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
 * Reads a registry source of the game page directly.
 *
 * @param page - The test page.
 * @param id - The source id.
 * @param input - The source input.
 * @returns The value.
 */
async function readSource<T>(page: Page, id: string, input: object = {}): Promise<T> {
  const json = await gameFrame(page).evaluate(
    async ([source, value]) => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { source(id: string): { read(input: object): Promise<unknown> } };
        }
      ).registry;
      return JSON.stringify(await registry.source(source).read(value));
    },
    [id, input] as const
  );
  return JSON.parse(json) as T;
}

/**
 * Maps a game page rect to client px through the iframe box.
 *
 * @param page - The test page.
 * @param rect - A rect in game CSS px.
 * @returns The rect in client px.
 */
async function toClient(page: Page, rect: Rect): Promise<Rect> {
  const box = await page.locator("iframe").first().boundingBox();
  if (box === null) throw new Error("no iframe box");
  const inner = await gameFrame(page).evaluate(() => innerWidth);
  const scale = box.width / inner;
  return {
    x: box.x + rect.x * scale,
    y: box.y + rect.y * scale,
    w: rect.w * scale,
    h: rect.h * scale
  };
}

/**
 * The distance between a measured box and an expected rect, the largest edge difference.
 *
 * @param actual - The measured box.
 * @param actual.x - Its left.
 * @param actual.y - Its top.
 * @param actual.width - Its width.
 * @param actual.height - Its height.
 * @param expected - The expected rect.
 * @returns The difference in px.
 */
function offBy(
  actual: { x: number; y: number; width: number; height: number },
  expected: Rect
): number {
  return Math.max(
    Math.abs(actual.x - expected.x),
    Math.abs(actual.y - expected.y),
    Math.abs(actual.width - expected.w),
    Math.abs(actual.height - expected.h)
  );
}

/**
 * "1 filter", "3 filters".
 *
 * @param count - The count.
 * @param one - The singular.
 * @param many - The plural.
 * @returns The text.
 */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Rounds to one decimal like the tiles do.
 *
 * @param value - A number.
 * @returns The text.
 */
function short(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * The Render host.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function render(page: Page): Locator {
  return page.locator("[data-workspace-host=render]");
}

/**
 * A metric tile.
 *
 * @param page - The test page.
 * @param id - The tile id.
 * @returns The locator.
 */
function tile(page: Page, id: string): Locator {
  return render(page).locator(`[data-tile=${id}]`);
}

/**
 * The text of a tile part, or "" when absent.
 *
 * @param page - The test page.
 * @param id - The tile id.
 * @param part - A selector inside the tile.
 * @returns The text.
 */
async function tileText(page: Page, id: string, part: string): Promise<string> {
  const locator = tile(page, id).locator(part).first();
  return (await locator.count()) === 0 ? "" : ((await locator.textContent()) ?? "").trim();
}

/**
 * The render tree.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function tree(page: Page): Locator {
  return render(page).locator("[data-render=tree] [role=tree]");
}

/**
 * The selected tree row.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function selectedRow(page: Page): Locator {
  return tree(page).locator("[role=treeitem][aria-selected=true]");
}

/**
 * The pink box renderView draws over the game frame.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function pinkBox(page: Page): Locator {
  return page.locator("[data-render=box] [data-box]");
}

/**
 * The cells of every texture row in table order.
 *
 * @param page - The test page.
 * @returns The rows.
 */
async function textureRows(page: Page): Promise<TextureCells[]> {
  return render(page)
    .locator("[data-render=textures] tbody tr")
    .evaluateAll(rows =>
      rows.map(row => {
        const cells = [...row.querySelectorAll("td")].map(cell => (cell.textContent ?? "").trim());
        return {
          key: cells[0] ?? "",
          bundle: cells[1] ?? "",
          size: cells[2] ?? "",
          gpuMb: cells[3] ?? "",
          fileMb: cells[4] ?? "",
          use: cells[5] ?? "",
          data: row.dataset.use ?? ""
        };
      })
    );
}

/**
 * Tells whether a row's use tag text matches its `data-use` state.
 *
 * @param row - The row.
 * @returns True when "in use", "unused since fN" or "not seen since fN" fits the state.
 */
function tagMatches(row: TextureCells): boolean {
  if (row.data === "in-use") return row.use === "in use";
  if (row.data === "unused") return /^unused since f\d+$/.test(row.use);
  return row.data === "not-seen" && /^not seen since f\d+$/.test(row.use);
}

/** The use rank the table sorts by: in use, unused, not seen. */
const USE_RANK: Readonly<Record<string, number>> = { "in-use": 0, unused: 1, "not-seen": 2 };

/**
 * The value a texture row sorts by.
 *
 * @param row - The row.
 * @param key - The sort key.
 * @returns The value.
 */
function sortValue(row: TextureCells, key: string): number | string {
  if (key === "key") return row.key;
  if (key === "bundle") return row.bundle;
  if (key === "use") return USE_RANK[row.data] ?? 9;
  if (key === "size") {
    const [w, h] = row.size.split("×").map(Number);
    return (w ?? 0) * (h ?? 0);
  }
  return Number(key === "gpuMb" ? row.gpuMb : row.fileMb);
}

/**
 * Sorts rows like the table: by the key in the direction, ties by texture key ascending. The
 * displayed MB values are rounded, so a numeric tie on screen is also accepted in either order by
 * the caller comparing sort values, not keys.
 *
 * @param rows - The rows.
 * @param key - The sort key.
 * @param dir - 1 ascending, -1 descending.
 * @returns The sort values in order.
 */
function sortedValues(
  rows: readonly TextureCells[],
  key: string,
  dir: 1 | -1
): (number | string)[] {
  return rows
    .map(row => sortValue(row, key))
    .toSorted((a, b) =>
      typeof a === "number" && typeof b === "number"
        ? (a - b) * dir
        : String(a).localeCompare(String(b)) * dir
    );
}

/**
 * Shows Render and waits for the first scene, the catalogue and the texture rows.
 *
 * @param tools - The driver.
 */
async function showRender(tools: Tools): Promise<void> {
  const page = tools.page;
  await tools.show("render");
  await expect(tree(page).locator("[role=treeitem]").first()).toBeVisible({ timeout: 15_000 });
  await expect(render(page).locator("[data-render=textures] tbody tr").first()).toBeVisible();
  await expect
    .poll(
      async () => {
        const expected = await loadedTextureCount(page);
        return (await render(page).locator("[data-render=textures] tbody tr").count()) === expected;
      },
      { message: "every texture of the loaded bundles" }
    )
    .toBe(true);
}

/**
 * The textures of the manifest whose bundle game.assets reports loaded: the rows the table owes.
 *
 * @param page - The test page.
 * @returns The count.
 */
async function loadedTextureCount(page: Page): Promise<number> {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as {
    bundles: Record<string, { files: { kind?: string }[] }>;
  };
  const assets = await readSource<AssetsUsage>(page, "game.assets");
  return assets.bundles.reduce(
    (sum, bundle) =>
      sum +
      (manifest.bundles[bundle.name]?.files.filter(file => (file.kind ?? "texture") === "texture")
        .length ?? 0),
    0
  );
}

/**
 * Makes the game preview visible in Render: the half-screen windows may start with it hidden,
 * in which case the tree hint offers "Show game".
 *
 * @param page - The test page.
 */
async function ensurePreview(page: Page): Promise<void> {
  const show = render(page).locator("[data-render=tree] [data-action=show-game]");
  if (await show.isVisible()) {
    await show.click();
    await expect(show).toBeHidden();
  }
  await expect(page.locator("iframe").first()).toBeVisible();
}

/**
 * The ui keys of the open tree rows that carry a key marker, with their row ids.
 *
 * @param page - The test page.
 * @returns `[rowId, key]` pairs.
 */
async function keyedRows(page: Page): Promise<[string, string][]> {
  return tree(page)
    .locator("[role=treeitem]")
    .evaluateAll(rows =>
      rows.flatMap(row => {
        const key = row.querySelector(":scope > [data-line] [data-marker=key]")?.textContent;
        const id = row.dataset.id;
        return key && id ? [[id, key] as [string, string]] : [];
      })
    );
}

test.describe("render · tiles", () => {
  test("the six tiles show the live game.render, game.assets and game.effects numbers", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);

    // Title: the frame of the last game.render value, close to the link pill frame.
    await expect(render(page).locator("[data-render=workspace] > h1")).toHaveText(
      /^Render · game\.render · frame \d+$/
    );

    // FPS: a whole number, the sample count and the low, and one sparkline point per sample; at
    // the game's idle rate (28-32 fps, D-28) the sub line says why instead.
    await expect
      .poll(async () => {
        const sub = await tileText(page, "fps", "[data-sub]");
        const match = /^last (\d+) samples? · low (\d+)$/.exec(sub);
        const value = Number(await tileText(page, "fps", "[data-value] strong"));
        const points = (await tile(page, "fps").locator("polyline").getAttribute("points")) ?? "";
        const count = points.trim() === "" ? 0 : points.trim().split(/\s+/).length;
        if (sub === RESTING) {
          const isResting = Number.isInteger(value) && value >= 28 && value <= 32 && count >= 2;
          return isResting ? "ok" : `resting value ${value} points ${count}`;
        }
        if (match === null) return `sub ${sub}`;
        const samples = Number(match[1]);
        const pointsOk = count === Math.max(2, samples);
        return Number.isInteger(value) && value >= Number(match[2]) && samples >= 2 && pointsOk
          ? "ok"
          : `value ${value} samples ${samples} points ${count}`;
      })
      .toBe("ok");
    await expect(tile(page, "fps").locator("[data-unit]")).toHaveText("fps");

    // Frame time: frameMs at one decimal and a bar at frameMs / 16.7 ms.
    await expect
      .poll(async () => {
        const stats = await readSource<RenderStats>(page, "game.render");
        const value = await tileText(page, "frame", "[data-value] strong");
        const bar = await tile(page, "frame")
          .locator("[data-bar] [data-phase]")
          .getAttribute("style");
        const percent = Math.min(100, Math.round((stats.frameMs / (1000 / 60)) * 100));
        return value === short(stats.frameMs) && (bar ?? "").includes(`inline-size: ${percent}%`);
      })
      .toBe(true);
    await expect(tile(page, "frame").locator("[data-sub]")).toHaveText(
      "Phase split not reported by game.render"
    );

    // Draw calls: the dev-build counter per frame, render passes in the sub-line.
    await expect
      .poll(async () => {
        const stats = await readSource<RenderStats>(page, "game.render");
        const value = await tileText(page, "draws", "[data-value] strong");
        const sub = await tileText(page, "draws", "[data-sub]");
        return (
          value === String(stats.drawCalls) &&
          sub === counted(stats.renderPasses ?? 0, "render pass", "render passes")
        );
      })
      .toBe(true);
    await expect(tile(page, "draws").locator("[data-unit]")).toHaveText("per frame");
    await expect(tile(page, "draws")).not.toHaveAttribute("data-absent");

    // Texture memory: GPU MB and counts from game.render, bundles and budget from game.assets,
    // the warn line from the texture rows that are not in use.
    await expect
      .poll(async () => {
        const stats = await readSource<RenderStats>(page, "game.render");
        const assets = await readSource<AssetsUsage>(page, "game.assets");
        const rows = await textureRows(page);
        const idle = rows.filter(row => row.data !== "in-use");
        const idleMb = idle.reduce((sum, row) => sum + Number(row.gpuMb), 0);
        const value = await tileText(page, "textures", "[data-value] strong");
        const sub = await tileText(page, "textures", "[data-sub]");
        const warn = await tileText(page, "textures", "[data-warn]");
        const expectedSub = `${stats.textures} textures · ${assets.bundles.length} bundles · of ${assets.budgetMb} MB budget`;
        const warnOk =
          warn.startsWith(`${idle.length} unused · `) &&
          Math.abs(Number(/· ([\d.]+) MB$/.exec(warn)?.[1]) - idleMb) < 0.05;
        return value === stats.textureMb.toFixed(2) && sub === expectedSub && warnOk
          ? "ok"
          : `${value} | ${sub} | ${warn}`;
      })
      .toBe("ok");

    // Scene: the display objects and pools of game.render, effects from game.effects (game 0.1.0).
    await expect
      .poll(async () => {
        const stats = await readSource<RenderStats>(page, "game.render");
        const effects = await readSource<EffectsStats>(page, "game.effects");
        const sub = await tileText(page, "scene", "[data-sub]:not([data-note])");
        const note = await tileText(page, "scene", "[data-note]");
        const expectedNote = [
          counted(effects.particles, "particle", "particles"),
          counted(effects.emitters, "emitter", "emitters"),
          counted(effects.filters, "filter", "filters")
        ].join(" · ");
        return sub === `${stats.views} display objects · ${stats.pooled} pooled` &&
          note === expectedNote
          ? "ok"
          : `${sub} | ${note} | ${expectedNote}`;
      })
      .toBe("ok");
    await expect(tile(page, "scene").locator("[data-value] strong")).toHaveText(/^\d+$/);
    await expect(tile(page, "scene").locator("[data-unit]")).toHaveText("entities");

    // JS heap: Chromium reports the page heap (performance.memory) in the heartbeat, so the tile
    // shows the used MB of the limit.
    const heap = tile(page, "heap");
    await expect(heap).toBeVisible();
    await expect(heap).not.toHaveAttribute("data-absent");
    await expect(heap.locator("h2")).toHaveText("JS heap");
    await expect(heap.locator("[data-value] strong")).toHaveText(/^\d+(\.\d)?$/);
    await expect(heap.locator("[data-unit]")).toHaveText("MB");
    const limitMb = await gameFrame(page).evaluate(() => {
      const memory = Reflect.get(performance, "memory") as { jsHeapSizeLimit: number } | undefined;
      return memory === undefined ? -1 : Math.round((memory.jsHeapSizeLimit / 2 ** 20) * 10) / 10;
    });
    expect(limitMb, "Chromium reports performance.memory").toBeGreaterThan(0);
    await expect(heap.locator("[data-sub]")).toHaveText(`of ${short(limitMb)} MB`);
    const usedMb = Number(await heap.locator("[data-value] strong").textContent());
    expect(usedMb).toBeGreaterThan(0);
    expect(usedMb).toBeLessThanOrEqual(limitMb);
  });
});

test.describe("render · tree", () => {
  test("Expand all, Collapse and the twisties open and close rows; the head counts the scene", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);
    const head = render(page).locator("[data-render=tree] [data-count]");
    await expect(head).toHaveText(/^\d+ nodes · \d+ with textures · \d+ entities$/);
    const nodes = Number(/^(\d+)/.exec((await head.textContent()) ?? "")?.[1]);
    const rows = tree(page).locator("[role=treeitem]");

    await render(page).locator("[data-render=tree] [data-action=expand-all]").click();
    await expect(rows).toHaveCount(nodes);
    await expect(tree(page).locator("[role=treeitem][aria-expanded=false]")).toHaveCount(0);

    await render(page).locator("[data-render=tree] [data-action=collapse-all]").click();
    await expect(tree(page).locator("[role=treeitem][aria-expanded=true]")).toHaveCount(0);
    const roots = await rows.count();
    expect(roots).toBeLessThan(nodes);
    await expect(rows.first()).toHaveAttribute("aria-level", "1");

    // The twisty of the first root opens one level, then closes it again.
    const first = rows.first();
    await first.locator("[data-twisty]").click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(rows.nth(1)).toHaveAttribute("aria-level", "2");
    const opened = await rows.count();
    expect(opened).toBeGreaterThan(roots);
    await first.locator("[data-twisty]").click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(rows).toHaveCount(roots);
  });

  test("keys: ↓/↑ move, → opens and enters, ← closes and leaves, Enter toggles the detail", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);
    await render(page).locator("[data-render=tree] [data-action=collapse-all]").click();
    const rows = tree(page).locator("[role=treeitem]");
    const first = rows.first();
    await first.click();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(first.locator("[data-detail]")).toBeVisible();
    await tree(page).focus();

    await page.keyboard.press("ArrowRight");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(rows.nth(1)).toHaveAttribute("aria-level", "2");
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");

    // Enter closes and reopens the inline detail of the selected row.
    await expect(rows.nth(1).locator("[data-detail]")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(tree(page).locator("[data-detail]")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(rows.nth(1).locator("[data-detail]")).toBeVisible();

    // ← on a child moves to the parent; ← on the open parent closes it.
    await page.keyboard.press("ArrowLeft");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(first).toHaveAttribute("aria-expanded", "false");
  });

  test("the detail shows the path and the element's real bounds; Inspect in Game selects it in Game", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);
    await render(page).locator("[data-render=tree] [data-action=expand-all]").click();
    const keyed = await keyedRows(page);
    const [rowId, key] = keyed.find(([, k]) => k === "play") ?? keyed[0] ?? ["", ""];
    expect(key).not.toBe("");
    const row = tree(page).locator(`[role=treeitem][data-id="${rowId}"]`);
    await row.locator(":scope > [data-line] [data-name]").click();
    await expect(row).toHaveAttribute("aria-selected", "true");

    const detail = row.locator("[data-detail]");
    const rect = await readSource<Rect>(page, "game.rect", { key });
    await expect(detail.locator("dt", { hasText: "Path" }).locator("+ dd")).toHaveText(
      new RegExp(`(^|/)${key}$`)
    );
    await expect(detail.locator("dt", { hasText: "Bounds" }).locator("+ dd")).toHaveText(
      `${short(rect.x)} · ${short(rect.y)} · ${short(rect.w)}×${short(rect.h)}`
    );

    await detail.getByRole("button", { name: "Inspect in Game" }).click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "game");
    const element = page.locator("[data-workspace-host=game] [data-game=side] [data-part=element]");
    await expect(element.locator("[data-part=name]")).toHaveText(key);
  });

  test("hovering a row draws the pink box over the game frame at the element's real rect", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);
    await ensurePreview(page);
    await render(page).locator("[data-render=tree] [data-action=expand-all]").click();
    const keyed = await keyedRows(page);
    const [rowId, key] = keyed.find(([, k]) => k === "play") ?? keyed[0] ?? ["", ""];
    const row = tree(page).locator(`[role=treeitem][data-id="${rowId}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.locator(":scope > [data-line] [data-name]").hover();
    await expect(pinkBox(page)).toBeVisible();
    await expect
      .poll(async () => {
        const box = await pinkBox(page).boundingBox();
        const expected = await toClient(page, await readSource<Rect>(page, "game.rect", { key }));
        return box === null ? 99 : offBy(box, expected);
      })
      .toBeLessThan(1.5);
    await expect(pinkBox(page)).toHaveCSS("pointer-events", "none");

    // Leaving the row clears the box.
    await render(page).locator("[data-render=tree] h2").hover();
    await expect(pinkBox(page)).toHaveCount(0);
  });
});

test.describe("render · textures, bundles, pools, release log", () => {
  test("the bundle chips filter the rows; All brings them back", async ({ tools }) => {
    const page = tools.page;
    await showRender(tools);
    const chips = render(page).locator("[data-render=textures] [role=radiogroup] [role=radio]");
    const all = await textureRows(page);
    await expect(chips.first()).toHaveText(`All ${all.length}`);
    await expect(chips.first()).toHaveAttribute("aria-checked", "true");
    const bundles = [...new Set(all.map(row => row.bundle))].toSorted();
    const texts = await chips.allTextContents();
    const labels = texts.slice(1);
    expect(labels.toSorted()).toEqual(
      bundles.map(bundle => `${bundle} ${all.filter(row => row.bundle === bundle).length}`)
    );

    for (const bundle of bundles) {
      const chip = chips.filter({ hasText: new RegExp(String.raw`^${bundle} \d+$`) });
      await chip.click();
      await expect(chip).toHaveAttribute("aria-checked", "true");
      await expect(chips.first()).toHaveAttribute("aria-checked", "false");
      const rows = await textureRows(page);
      expect(rows.length).toBe(all.filter(row => row.bundle === bundle).length);
      expect(rows.every(row => row.bundle === bundle)).toBe(true);
    }
    await chips.first().click();
    await expect(render(page).locator("[data-render=textures] tbody tr")).toHaveCount(all.length);
  });

  test("every column sorts both ways with aria-sort and an arrow", async ({ tools }) => {
    const page = tools.page;
    await showRender(tools);
    const columns: readonly [key: string, label: string, first: 1 | -1][] = [
      ["key", "Texture", 1],
      ["bundle", "Bundle", 1],
      ["size", "Size", -1],
      ["gpuMb", "GPU MB", -1],
      ["fileMb", "File MB", -1],
      ["use", "Use", 1]
    ];
    for (const [key, label, first] of columns) {
      const th = render(page).locator(`[data-render=textures] th[data-sort=${key}]`);
      for (const dir of [first, -first as 1 | -1]) {
        await th.getByRole("button").click();
        const aria = dir === 1 ? "ascending" : "descending";
        await expect(th).toHaveAttribute("aria-sort", aria);
        await expect(th.getByRole("button")).toHaveText(`${label} ${dir === 1 ? "↑" : "↓"}`);
        await expect(render(page).locator("[data-render=textures] th[aria-sort]")).toHaveCount(1);
        await expect
          .poll(
            async () => {
              const rows = await textureRows(page);
              const shown = rows.map(row => sortValue(row, key));
              return JSON.stringify(shown) === JSON.stringify(sortedValues(rows, key, dir));
            },
            { message: `${key} ${aria}` }
          )
          .toBe(true);
      }
    }
  });

  test("the use tags: rows drawn in the scene are in use, the others say since when they are not", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);
    await render(page).locator("[data-render=tree] [data-action=expand-all]").click();
    const drawn = new Set(await tree(page).locator("[data-marker=texture]").allTextContents());
    expect(drawn.size).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const rows = await textureRows(page);
        const inUse = new Set(
          rows
            .filter(row => row.data === "in-use")
            .map(row => row.key)
            .toSorted()
        );
        const tagsOk = rows.every(row => tagMatches(row));
        // Every texture a tree node draws is in use. Image and icon nodes do not name their
        // texture in game.ui (follow-up F-G1), so in-use rows may have no marker in the tree.
        return tagsOk && [...drawn].every(key => inUse.has(key));
      })
      .toBe(true);

    // GPU MB is w × h × 4 bytes in MiB.
    const sample = await textureRows(page);
    for (const row of sample.slice(0, 8)) {
      const [w, h] = row.size.split("×").map(Number);
      expect(row.gpuMb).toBe((((w ?? 0) * (h ?? 0) * 4) / 2 ** 20).toFixed(2));
    }
  });

  test("hovering an in-use texture row boxes the node that draws it", async ({ tools }) => {
    const page = tools.page;
    await showRender(tools);
    await ensurePreview(page);
    const row = render(page)
      .locator("[data-render=textures] tbody tr[data-use=in-use]:not([title='not on screen'])")
      .first();
    const texture = await row.getAttribute("data-key");
    await render(page).locator("[data-render=tree] [data-action=expand-all]").click();
    const host = tree(page)
      .locator("[role=treeitem]")
      .filter({
        has: page.locator(`:scope > [data-line] [data-marker=texture]:text-is("${texture}")`)
      })
      .first();
    const key = (
      (await host.locator(":scope > [data-line] [data-marker=key]").textContent()) ?? ""
    ).trim();
    expect(key).not.toBe("");
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await expect(row).toHaveAttribute("data-hover", "");
    await expect(pinkBox(page)).toBeVisible();
    await expect
      .poll(async () => {
        const box = await pinkBox(page).boundingBox();
        const expected = await toClient(page, await readSource<Rect>(page, "game.rect", { key }));
        return box === null ? 99 : offBy(box, expected);
      })
      .toBeLessThan(1.5);
    await render(page).locator("[data-render=textures] h2").hover();
    await expect(row).not.toHaveAttribute("data-hover");
    await expect(pinkBox(page)).toHaveCount(0);
  });

  test("Bundles, Pools and Release log show game.assets and game.render", async ({ tools }) => {
    const page = tools.page;
    await showRender(tools);
    const assets = await readSource<AssetsUsage>(page, "game.assets");
    const card = render(page).locator("[data-render=bundles]");
    await expect(card.locator("header [data-count]")).toHaveText(String(assets.bundles.length));
    const items = card.locator("li");
    await expect(items).toHaveCount(assets.bundles.length);
    for (const [index, bundle] of assets.bundles.entries()) {
      const item = items.nth(index);
      await expect(item.locator("[data-name]")).toHaveText(bundle.name);
      await expect(item.locator("[data-tag='']")).toHaveText(bundle.tier);
      await expect(item.locator("[data-tag=ok]")).toHaveText("loaded");
      await expect(item.locator("[data-mb]")).toHaveText(`${bundle.mb} MB`);
    }
    await expect(card.locator("footer")).toHaveText(
      `Budget ${assets.budgetMb} MB · used ${assets.textureMb} MB`
    );

    await expect
      .poll(async () => {
        const stats = await readSource<RenderStats>(page, "game.render");
        const line = await render(page)
          .locator("[data-render=pools] [data-line] > span")
          .first()
          .textContent();
        return line === `All pools · ${stats.pooled} pooled · ${stats.views} in use`;
      })
      .toBe(true);
    await expect(render(page).locator("[data-render=pools] [data-sub]")).toHaveText(
      "Per-pool counts need game.render pools (follow-up F-R1)"
    );

    // The merge-game never unloads a bundle (scene tier "board" stays after leaving the board), so
    // the log stays empty: every bundle of game.assets is still loaded.
    await expect(render(page).locator("[data-render=releases] [data-empty]")).toHaveText(
      "No bundle released since the editor connected."
    );
  });

  test("Refresh re-reads the asset manifest: gone empties the table, back fills it", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);
    const rows = render(page).locator("[data-render=textures] tbody tr");
    const count = await rows.count();
    const refresh = render(page).locator("[data-render=textures] [data-action=refresh]");
    await rename(MANIFEST, MANIFEST_AWAY);
    try {
      await refresh.click();
      await expect(render(page).locator("[data-render=textures] [data-empty]")).toHaveText(
        "No asset manifest found at manifest.json, public/manifest.json, web/manifest.json · per-texture data needs game.textures (follow-up F-R2)"
      );
      await expect(rows).toHaveCount(0);
    } finally {
      await rename(MANIFEST_AWAY, MANIFEST);
    }
    await refresh.click();
    await expect(rows).toHaveCount(count);
    await expect(render(page).locator("[data-render=textures] [data-empty]")).toHaveCount(0);
  });

  test("a Textures palette item shows Render, filters its bundle and selects the node drawing it", async ({
    tools
  }) => {
    const page = tools.page;
    await showRender(tools);
    const row = render(page)
      .locator("[data-render=textures] tbody tr[data-use=in-use]:not([title='not on screen'])")
      .first();
    const key = ((await row.locator("td").first().textContent()) ?? "").trim();
    const bundle = ((await row.locator("td").nth(1).textContent()) ?? "").trim();

    await tools.show("state");
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator("dialog[data-ui=palette]");
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox", { name: "Search" }).fill(key);
    const escaped = key.replaceAll(".", String.raw`\.`);
    const option = palette.getByRole("option", {
      name: new RegExp(`^${escaped}`)
    });
    await expect(option.first()).toBeVisible();
    await option.first().click();
    await expect(palette).toBeHidden();

    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "render");
    const chip = render(page).locator("[data-render=textures] [role=radio][aria-checked=true]");
    await expect(chip).toHaveText(new RegExp(String.raw`^${bundle} \d+$`));
    await expect(selectedRow(page)).toHaveCount(1);
    await expect(
      selectedRow(page).locator(":scope > [data-line] [data-marker=texture]")
    ).toHaveText(key);
    await expect(selectedRow(page)).toBeInViewport();
  });

  test("the workspace scrolls inside its own area; the page does not", async ({ tools }) => {
    const page = tools.page;
    await showRender(tools);
    const releases = render(page).locator("[data-render=releases]");
    const scrolled = await releases.evaluate(element => {
      let node: HTMLElement | null = element.parentElement;
      while (node !== null) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
          node.scrollTop = node.scrollHeight;
          return true;
        }
        node = node.parentElement;
      }
      return false;
    });
    expect(scrolled, "the workspace has its own scroller").toBe(true);
    await expect(releases).toBeInViewport();
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
