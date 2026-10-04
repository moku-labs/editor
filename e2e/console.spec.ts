/**
 * @file The Console workspace (spec 17-consoleView) in a real browser, on the frozen merge-game:
 * the live game log (the boot debug line and a warn line the game logs for the dev command
 * `game.fill` on a key without an input), the level counts and the filter segments, search with
 * highlighted hits, `/` and Esc, the detail drawer (fields, data, the frame link that focuses Flow),
 * keyboard selection in the grid, Clear, Preserve log off and on across a game reload (the meta
 * rows), the rail badge, a failed command run (the D1 error line) and the windowed list with the
 * "N new lines" pill.
 *
 * Ground truth is read from the game page: `globalThis.editor.registry` answers `game.log`, the same
 * source the tools page watches.
 */
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";

/** One `game.log` entry. */
type Entry = { readonly level: string; readonly event: string; readonly ts: number };

/** The warn line the game logs for `game.fill` on a key without an input. */
const FILL_WARNING = /event: ui:fill-without-input/;

/** Game-frame warnings a reload provokes that are not editor defects (see game.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/**
 * Pads a number with leading zeros.
 *
 * @param value - The number.
 * @param size - The digits.
 * @returns The padded text.
 */
function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

/**
 * The number of lines `game.log` holds.
 *
 * @param page - The test page.
 * @returns The count.
 */
async function gameLogLength(page: Page): Promise<number> {
  const trace = await gameLog(page);
  return trace.length;
}

/**
 * The top of the preview float.
 *
 * @param page - The test page.
 * @returns Its y, undefined while hidden.
 */
async function previewTop(page: Page): Promise<number | undefined> {
  const box = await page.locator("[data-ui=preview]").boundingBox();
  return box?.y;
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
 * Reads `game.log` on the game page.
 *
 * @param page - The test page.
 * @returns The trace.
 */
async function gameLog(page: Page): Promise<Entry[]> {
  return gameFrame(page).evaluate(async () => {
    const registry = (
      Reflect.get(globalThis, "editor") as {
        registry: { source(id: string): { read(input: object): Promise<Entry[]> } };
      }
    ).registry;
    return registry.source("game.log").read({});
  });
}

/**
 * Runs the game's `game.fill` dev command on a key that has no input, `times` times: the game
 * logs one debug line (`moku:dev`) and one warn line (`ui:fill-without-input`) for each.
 *
 * @param page - The test page.
 * @param times - How many runs.
 */
async function fillMissing(page: Page, times = 1): Promise<void> {
  await gameFrame(page).evaluate(async count => {
    const registry = (
      Reflect.get(globalThis, "editor") as {
        registry: { command(id: string): { run(input: object): Promise<unknown> } };
      }
    ).registry;
    for (let index = 0; index < count; index += 1) {
      await registry.command("game.fill").run({ key: "nope", value: "x" });
    }
  }, times);
}

/**
 * The Console host.
 *
 * @param page - The test page.
 * @returns The host.
 */
function consoleHost(page: Page): Locator {
  return page.locator("[data-workspace-host=console]");
}

/**
 * The grid.
 *
 * @param page - The test page.
 * @returns The grid.
 */
function grid(page: Page): Locator {
  return consoleHost(page).getByRole("grid", { name: "Console log" });
}

/**
 * The entry rows (not meta, not spacers) the grid draws.
 *
 * @param page - The test page.
 * @returns The rows.
 */
function entryRows(page: Page): Locator {
  return grid(page).locator("tbody tr[data-level]");
}

/**
 * A level segment of the toolbar.
 *
 * @param page - The test page.
 * @param level - all, info, warn or error.
 * @returns The segment.
 */
function segment(page: Page, level: string): Locator {
  return consoleHost(page).locator(`[role=radio][data-level=${level}]`);
}

/**
 * The count of a level segment.
 *
 * @param page - The test page.
 * @param level - all, info, warn or error.
 * @returns The number shown.
 */
async function countOf(page: Page, level: string): Promise<number> {
  return Number(await segment(page, level).locator("[data-count]").textContent());
}

/**
 * The counts the toolbar must show for a trace: all includes debug.
 *
 * @param trace - The game.log entries.
 * @returns The counts.
 */
function countsOf(trace: readonly Entry[]): Record<string, number> {
  const of = (level: string): number => trace.filter(entry => entry.level === level).length;
  return { all: trace.length, info: of("info"), warn: of("warn"), error: of("error") };
}

/**
 * The toolbar counts.
 *
 * @param page - The test page.
 * @returns The counts.
 */
async function shownCounts(page: Page): Promise<Record<string, number>> {
  return {
    all: await countOf(page, "all"),
    info: await countOf(page, "info"),
    warn: await countOf(page, "warn"),
    error: await countOf(page, "error")
  };
}

/**
 * The rail button of Console.
 *
 * @param tools - The driver.
 * @returns The button.
 */
function railConsole(tools: Tools): Locator {
  return tools.railButton("console");
}

/**
 * The last toast.
 *
 * @param page - The test page.
 * @returns The toast.
 */
function toast(page: Page): Locator {
  return page.locator("[data-ui=toasts] [data-toast]").last();
}

/**
 * The meta rows' texts.
 *
 * @param page - The test page.
 * @returns The texts.
 */
async function metaTexts(page: Page): Promise<string[]> {
  return grid(page).locator("tbody tr[data-meta]").allTextContents();
}

/**
 * Reloads the game page with the Game toolbar and waits for the new game's link.
 *
 * @param tools - The driver.
 */
async function reloadGame(tools: Tools): Promise<void> {
  const page = tools.page;
  await tools.show("game");
  await gameFrame(page).evaluate(() => Reflect.set(globalThis, "__e2eMark", 1));
  await tools.host("game").locator("[data-game=toolbar] [data-part=reload]").click();
  await expect
    .poll(async () => {
      try {
        return await gameFrame(page).evaluate(() => Reflect.get(globalThis, "__e2eMark") === 1);
      } catch {
        return true;
      }
    })
    .toBe(false);
  await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
    timeout: 30_000
  });
}

/** A client rect. */
type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Whether two boxes share any area (see half-screen.spec.ts).
 *
 * @param a - One box.
 * @param b - The other box.
 * @returns True when they overlap.
 */
function overlaps(a: Box, b: Box): boolean {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0;
}

/**
 * The boxes of the preview float and of the drawer with each of its controls.
 *
 * @param page - The test page.
 * @returns The preview box and the named drawer boxes.
 */
async function drawerAndPreview(page: Page): Promise<{ preview: Box; parts: [string, Box][] }> {
  const preview = await page.locator("[data-ui=preview]").boundingBox();
  if (preview === null) throw new Error("no preview float");
  const drawer = consoleHost(page).locator("[data-part=drawer]");
  const parts: [string, Box][] = [];
  const whole = await drawer.boundingBox();
  if (whole !== null) parts.push(["drawer", whole]);
  for (const control of await drawer.locator("button, [data-frame-link], pre").all()) {
    const box = await control.boundingBox();
    const name = (await control.getAttribute("aria-label")) ?? (await control.textContent()) ?? "";
    if (box !== null) parts.push([name.slice(0, 24), box]);
  }
  return { preview, parts };
}

/**
 * The drawer parts the preview float covers.
 *
 * @param page - The test page.
 * @returns Their names, empty when the float is clear.
 */
async function coveredByPreview(page: Page): Promise<string[]> {
  const { preview, parts } = await drawerAndPreview(page);
  return parts.filter(([, box]) => overlaps(box, preview)).map(([name]) => name);
}

test.describe("console · live log", () => {
  test("lines from the real game, counts that match game.log, level segments and the rail badge", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    const page = tools.page;
    await tools.show("console");

    // The boot line of the game: a debug line of the moku dev marker.
    const boot = entryRows(page).filter({ hasText: "renderer.drawCalls" }).first();
    await expect(boot.locator("[data-col=level]")).toHaveText("debug");
    await expect(boot.locator("[data-col=source]")).toHaveText("moku");
    await expect(boot.locator("[data-col=message]")).toHaveText(
      'dev {"command":"renderer.drawCalls"}'
    );
    await expect(boot.locator("[data-frame-link]")).toHaveText(/^≤\d+$/);
    await expect(boot.locator("[data-frame-link]")).toHaveAttribute(
      "title",
      /^Logged at or before frame \d+\. The engine log carries no frame yet\.$/
    );
    await expect(railConsole(tools).locator("[data-badge]")).toHaveCount(0);

    // A real game warning.
    await fillMissing(page);
    const warn = entryRows(page).filter({ hasText: "fill-without-input" });
    await expect(warn).toHaveCount(1);
    await expect(warn).toHaveAttribute("data-level", "warn");
    await expect(warn.locator("[data-col=source]")).toHaveText("ui");
    await expect(warn.locator("[data-col=message]")).toHaveText(
      'fill-without-input {"key":"nope"}'
    );
    await expect(warn.locator("[data-tag]")).toHaveAttribute("data-tag", "warn");

    // The counts match the game's own trace (all includes debug).
    await expect.poll(async () => shownCounts(page)).toEqual(countsOf(await gameLog(page)));
    expect(await countOf(page, "warn")).toBe(1);
    await expect(segment(page, "warn").locator("[data-count]")).toHaveAttribute(
      "data-tone",
      "warn"
    );
    await expect(segment(page, "error").locator("[data-count]")).not.toHaveAttribute(
      "data-tone",
      /.+/
    );

    // The rail badge: 1 warning.
    const badge = railConsole(tools).locator("[data-badge]");
    await expect(badge).toHaveText("1");
    await expect(badge).toHaveAttribute("data-tone", "warn");
    await expect(railConsole(tools)).toHaveAttribute("aria-label", "Console, 1 warning");

    // Level segments.
    await expect(segment(page, "all")).toHaveAttribute("aria-checked", "true");
    await segment(page, "warn").click();
    await expect(segment(page, "warn")).toHaveAttribute("aria-checked", "true");
    await expect(segment(page, "all")).toHaveAttribute("aria-checked", "false");
    await expect(entryRows(page)).toHaveCount(1);
    await expect(entryRows(page)).toHaveAttribute("data-level", "warn");
    await segment(page, "error").click();
    await expect(entryRows(page)).toHaveCount(0);
    await expect(consoleHost(page).locator("[data-empty]")).toHaveText(
      "No lines match this filter."
    );
    await segment(page, "info").click();
    await expect(consoleHost(page).locator("[data-empty]")).toHaveText(
      "No lines match this filter."
    );
    await segment(page, "all").click();
    await expect.poll(async () => entryRows(page).count()).toBe(await gameLogLength(page));
  });

  test("search highlights hits; / focuses the field and Esc clears it", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    const page = tools.page;
    await tools.show("console");
    await fillMissing(page);
    await expect(entryRows(page).filter({ hasText: "fill-without-input" })).toHaveCount(1);

    const search = consoleHost(page).getByRole("searchbox", { name: "Search the log" });
    await expect(search).toHaveAttribute("placeholder", "Search the log");
    await grid(page).focus();
    await page.keyboard.press("/");
    await expect(search).toBeFocused();
    await page.keyboard.type("WITHOUT-in");
    await expect(entryRows(page)).toHaveCount(1);
    await expect(entryRows(page).locator("mark[data-hit]")).toHaveText("without-in");
    // Case-insensitive over source + message: "ui" matches the source column.
    await search.fill("nope");
    await expect(entryRows(page).locator("mark[data-hit]").first()).toHaveText("nope");
    await search.fill("no line has this");
    await expect(consoleHost(page).locator("[data-empty]")).toHaveText(
      "No lines match this filter."
    );
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).not.toBeFocused();
    await expect.poll(async () => entryRows(page).count()).toBe(await gameLogLength(page));
  });

  test("a row opens the detail drawer; the frame link focuses Flow; Esc and × close it", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    const page = tools.page;
    await tools.show("console");
    await fillMissing(page);
    const warn = entryRows(page).filter({ hasText: "fill-without-input" });
    await warn.locator("[data-col=message]").click();
    await expect(warn).toHaveAttribute("aria-selected", "true");

    const drawer = consoleHost(page).locator("[data-part=drawer]");
    await expect(drawer.getByRole("heading")).toHaveText("Line details");
    const trace = await gameLog(page);
    const entry = trace.find(line => line.event === "ui:fill-without-input");
    if (entry === undefined) throw new Error("no warn entry in game.log");
    // The page runs in UTC (playwright.config timezoneId).
    const date = new Date(entry.ts);
    await expect(drawer.locator("[data-field=time]")).toHaveText(
      `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`
    );
    await expect(drawer.locator("[data-field=level]")).toHaveText("warn");
    await expect(drawer.locator("[data-field=source]")).toHaveText("ui");
    await expect(drawer.locator("[data-field=event]")).toHaveText("ui:fill-without-input");
    await expect(drawer.locator("pre[data-json]")).toHaveText(
      JSON.stringify({ key: "nope" }, undefined, 2)
    );

    // Esc closes the drawer and clears the selection.
    await grid(page).focus();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(warn).toHaveAttribute("aria-selected", "false");

    // × closes it too.
    await warn.locator("[data-col=message]").click();
    await drawer.getByRole("button", { name: "Close details" }).click();
    await expect(drawer).toHaveCount(0);

    // The frame link of the drawer: Flow shows and focuses that frame.
    await warn.locator("[data-col=message]").click();
    const link = drawer.locator("[data-field=frame] [data-frame-link]");
    const frame = Number(((await link.textContent()) ?? "").replace("≤", ""));
    expect(frame).toBeGreaterThan(0);
    await link.click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "flow");
    await expect(toast(page)).toHaveText(
      new RegExp(
        `^(Frame ${frame} · |No edge at frame ${frame}|Frames are not recorded in this history)`
      )
    );
  });

  test("the game preview floats above the open drawer: no drawer control is under it", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    const page = tools.page;
    await tools.show("console");
    const preview = page.locator("[data-ui=preview]");
    await expect(preview).toBeVisible();
    const closed = await preview.boundingBox();
    await fillMissing(page);
    const warn = entryRows(page).filter({ hasText: "fill-without-input" });
    await warn.locator("[data-col=message]").click();
    const drawer = consoleHost(page).locator("[data-part=drawer]");
    await expect(drawer).toBeVisible();

    // The float moves up with the drawer and stays fully above it.
    await expect.poll(() => coveredByPreview(page)).toEqual([]);
    const opened = await preview.boundingBox();
    const drawerBox = await drawer.boundingBox();
    if (closed === null || opened === null || drawerBox === null) throw new Error("no boxes");
    expect(opened.y).toBeLessThan(closed.y);
    expect(opened.y + opened.height).toBeLessThanOrEqual(drawerBox.y);
    expect(opened.x).toBe(closed.x);

    // The × is reachable and works with a real click (no element on top of it).
    await drawer.getByRole("button", { name: "Close details" }).click({ trial: true });
    await drawer.getByRole("button", { name: "Close details" }).click();
    await expect(drawer).toHaveCount(0);
    // Closed again: the float goes back to its corner.
    await expect.poll(() => previewTop(page)).toBe(closed.y);

    // Another line in the drawer (the boot line, then back to the warn line) keeps it clear too.
    await entryRows(page).first().locator("[data-col=message]").click();
    await expect.poll(() => coveredByPreview(page)).toEqual([]);
    await warn.locator("[data-col=message]").click();
    await expect.poll(() => coveredByPreview(page)).toEqual([]);
  });

  test("grid keys: Enter selects the first line, ↓/↑ move the selection, Tab reaches the frame link", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("console");
    await expect(entryRows(page).first()).toBeVisible();
    const rows = grid(page).locator("tbody tr[data-key]");
    const count = await rows.count();
    await grid(page).focus();
    await page.keyboard.press("Enter");
    await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(consoleHost(page).locator("[data-part=drawer]")).toBeVisible();
    if (count > 1) {
      await page.keyboard.press("ArrowDown");
      await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(rows.nth(0)).toHaveAttribute("aria-selected", "false");
      await page.keyboard.press("ArrowUp");
    }
    await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Tab");
    await expect(rows.nth(0).locator("[data-frame-link]")).toBeFocused();
  });
});

test.describe("console · clear, preserve, commands", () => {
  test("Clear empties the log and the badge; new lines appear after it", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    const page = tools.page;
    await tools.show("console");
    await fillMissing(page);
    await expect(railConsole(tools).locator("[data-badge]")).toHaveText("1");
    const clear = consoleHost(page).getByRole("button", { name: "Clear" });
    await expect(clear).toHaveAttribute("title", "Clear the console");
    await clear.click();
    await expect(entryRows(page)).toHaveCount(0);
    await expect(consoleHost(page).locator("[data-empty]")).toHaveText(
      "The log is empty. Lines appear here as the game logs."
    );
    expect(await shownCounts(page)).toEqual({ all: 0, info: 0, warn: 0, error: 0 });
    await expect(railConsole(tools).locator("[data-badge]")).toHaveCount(0);
    await expect(railConsole(tools)).toHaveAttribute("aria-label", "Console");

    // Only lines logged after Clear come back.
    await fillMissing(page);
    await expect(entryRows(page)).toHaveCount(2);
    await expect(entryRows(page).nth(1)).toHaveAttribute("data-level", "warn");
    expect(await countOf(page, "warn")).toBe(1);
  });

  test("Preserve log off resets on a game reload; on keeps the lines with a marker row", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await tools.show("console");
    const preserve = consoleHost(page).getByRole("switch", { name: "Preserve log" });
    await expect(preserve).toHaveAttribute("aria-checked", "false");
    await fillMissing(page);
    await expect(entryRows(page).filter({ hasText: "fill-without-input" })).toHaveCount(1);

    await reloadGame(tools);
    await tools.show("console");
    await expect
      .poll(() => metaTexts(page), { timeout: 20_000 })
      .toContain("Log cleared: the game page reloaded. Turn on Preserve log to keep it.");
    await expect(entryRows(page).filter({ hasText: "fill-without-input" })).toHaveCount(0);

    await preserve.click();
    await expect(preserve).toHaveAttribute("aria-checked", "true");
    await fillMissing(page);
    await expect(entryRows(page).filter({ hasText: "fill-without-input" })).toHaveCount(1);
    await reloadGame(tools);
    await tools.show("console");
    await expect
      .poll(() => metaTexts(page), { timeout: 20_000 })
      .toContain("Game page reloaded · log preserved");
    await expect(entryRows(page).filter({ hasText: "fill-without-input" })).toHaveCount(1);
    await preserve.click();
    await expect(preserve).toHaveAttribute("aria-checked", "false");
  });

  test("a failed command run adds the error line; the badge turns red", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    const page = tools.page;
    // The game never rejects a one-frame step, so the server's answer to the step run is replaced by
    // the invalid-input error the protocol defines; every other message passes through.
    await page.routeWebSocket(/\/__editor\/ws/, socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => {
        const text = String(message);
        const parsed = JSON.parse(text) as {
          id?: number;
          method?: string;
          params?: { id?: string };
        };
        if (parsed.method === "run" && parsed.params?.id === "game.step") {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              error: {
                code: -32_602,
                message: "[moku-editor] game.step: frames must be a number",
                data: { reason: "invalid_input", field: "frames" }
              }
            })
          );
          return;
        }
        server.send(message);
      });
      server.onMessage(message => socket.send(message));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: 30_000
    });
    await tools.show("console");
    await page.keyboard.press("p");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");
    await page.keyboard.press(".");
    const step = page.locator("[data-ui=step-popover]");
    await expect(step).toHaveAttribute("data-ok", "false");
    await expect(step).toContainText("Logged in Console");

    const line = entryRows(page).filter({ hasText: "-32602 game.step: frames must be a number" });
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute("data-level", "error");
    await expect(line.locator("[data-col=source]")).toHaveText("editor");
    expect(await countOf(page, "error")).toBe(1);
    await expect(segment(page, "error").locator("[data-count]")).toHaveAttribute(
      "data-tone",
      "error"
    );
    const badge = railConsole(tools).locator("[data-badge]");
    await expect(badge).toHaveText("1");
    await expect(badge).toHaveAttribute("data-tone", "error");
    await expect(railConsole(tools)).toHaveAttribute("aria-label", "Console, 1 error");

    // A game warning on top: the badge counts both and stays red.
    await fillMissing(page);
    await expect(badge).toHaveText("2");
    await expect(railConsole(tools)).toHaveAttribute("aria-label", "Console, 1 warning, 1 error");
    await page.keyboard.press("p");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
  });

  test("many lines: the grid draws a window, scrolls inside the panel, and the new-lines pill", async ({
    tools,
    errors
  }) => {
    errors.allow(FILL_WARNING);
    const page = tools.page;
    await tools.show("console");
    await fillMissing(page, 150);
    await expect.poll(async () => countOf(page, "warn")).toBe(150);
    const total = await gameLogLength(page);
    await expect(grid(page)).toHaveAttribute("aria-rowcount", String(total + 1));
    // Only a window of rows is in the DOM.
    const drawn = await grid(page).locator("tbody tr[data-key]").count();
    expect(drawn).toBeLessThan(total);
    expect(drawn).toBeGreaterThan(10);

    // The list follows the bottom: the last line is drawn and in view.
    const scroller = consoleHost(page).locator("[data-part=logtable] [data-scroller]");
    const lastKey = await grid(page)
      .locator("tbody tr[data-key]")
      .last()
      .getAttribute("aria-rowindex");
    expect(Number(lastKey)).toBe(total + 1);
    // The page itself does not scroll: the panel does.
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);

    // Scrolled to the top: the first rows are drawn, the last are not.
    await scroller.evaluate(element => {
      element.scrollTop = 0;
    });
    await expect(grid(page).locator("tbody tr[data-key]").first()).toHaveAttribute(
      "aria-rowindex",
      "2"
    );
    await expect(grid(page).locator(`tbody tr[aria-rowindex="${total + 1}"]`)).toHaveCount(0);

    // New lines while scrolled up: the pill counts them and scrolls down on click.
    await fillMissing(page, 2);
    const pill = consoleHost(page).locator("[data-pill]");
    await expect(pill).toHaveText("4 new lines ↓");
    await pill.click();
    await expect(pill).toHaveCount(0);
    await expect(grid(page).locator(`tbody tr[aria-rowindex="${total + 5}"]`)).toBeInViewport();
  });
});
