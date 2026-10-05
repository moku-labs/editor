/**
 * @file Only the game reloads (captures-by-day U9, U10, B10), on the merge-game copy of game
 * v0.5.0 the bin serves with Bun hot reload on and the game's hot swap plugin loaded from the
 * copy's bunfig.toml (the bin re-runs itself in the game root, B2/B3).
 *
 * 1. The editor stands still: across the Game toolbar's Reload, Hot reload off then on, and a save
 *    of a rules file (a logic module: Bun reloads the page and the bridge restores it), a
 *    `layout-shift` observer on the tools page (buffered, every entry, `hadRecentInput` too) sums
 *    to 0 outside the toast stack (a top-layer overlay that grows and shrinks with its toasts),
 *    exactly one `[data-frame-reloading]` spinner shows on the game frame during each and
 *    none after, and no `[data-tone="error"]` appears.
 * 2. Hot swap: a style stepper press in the Element tab writes `features/home/styles.ts`; the game
 *    swaps the module in place: the same session, the same game page document, the toast "Game
 *    updated", the new style in `game.ui`. A save of a rules file then reloads the page and the
 *    bridge restores the same flow node in a new session.
 * 3. Popup restore: with Settings open over Home, a rules save restores `settings/open` with Home
 *    still under it (`game.ui` holds both screens) and the frame is not black.
 * 4. Texts (game 0.5.0 `content`): an area card over the top of Home holds `text "Лесной городок"`
 *    for the logo's name; a single pick of `homeCoinsText` carries `value "0"`.
 *
 * Every spec writes the game files it touched back. It runs in the desktop project only: what it
 * measures does not depend on the window.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";
import { barChecked, flipBarToggle } from "./top-bar";

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The captures folder of gameView, relative to the game root. */
const CAPTURES_DIR = ".moku/captures";

/** A logic module of the game: its save reaches no hot swap footer, Bun reloads the page. */
const RULES_FILE = "rules/rules.ts";

/** How long a reload may take: the restart or Bun's reload, the reconnect and the restore. */
const RELOAD_MS = 30_000;

/** The toast of a frame reload that restored the checkpoint. */
const RESTORED = "Game reloaded · state restored from the last checkpoint";

/** The toast of a save the game swapped in place (U10). */
const UPDATED = "Game updated";

/** The spinner of an expected reload on the game frame (B6). */
const SPINNER = "[data-frame-reloading]:not([hidden])";

/** The reference block inside a card file: its `text` fence. */
const TEXT_FENCE = /^```text\n([\s\S]*?)\n```$/m;

/** The one clipboard line of a single pick; group 1 is the name, group 2 the card path. */
const REFERENCE_LINE = /^@moku (\S+) \S+ · .* · (\.moku\/captures\/\S+-f\d+(?:-\d+)?\.md)$/;

/** The one clipboard line of an area pick; group 1 is the card path. */
const AREA_LINE = /^@moku area \d+×\d+ · .* · (\.moku\/captures\/\S+\/area-f\d+(?:-\d+)?\.md)$/;

/**
 * What a reload provokes on purpose and is not an editor defect: Bun's HMR client losing its
 * socket while the bin restarts (Hot reload switch, see top-bar.spec.ts) and the game's own asset
 * warnings after a reload (see flow.spec.ts).
 */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/_bun\/hmr' failed/,
  /^\[Bun\] Hot-module-reloading socket disconnected, reconnecting\.\.\.$/,
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * One layout shift the tools page saw: its score, whether input came just before, what moved, and
 * whether everything that moved is in the toast region (a top-layer overlay, not the editor).
 */
type Shift = {
  readonly value: number;
  readonly input: boolean;
  readonly moved: string[];
  readonly toast: boolean;
};

/** What the tools page saw during one phase. */
type Quiet = {
  /** Every layout shift of the phase. */
  readonly shifts: Shift[];
  /** The most spinners visible at one moment. */
  readonly spinnerMax: number;
  /** How often the spinner count went from 0 to 1 or more. */
  readonly spinnerShows: number;
  /** Every element that showed `data-tone="error"`: ms since the start, tag and text. */
  readonly errorTones: string[];
};

/** A node of `game.ui` as this spec reads it. */
type UiNode = {
  readonly key?: string;
  readonly style?: object;
  readonly children?: UiNode[];
};

/**
 * The game page frame.
 *
 * @param page - The tools page.
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
 * @param page - The tools page.
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
 * The game position path, "pending" while the page reloads.
 *
 * @param page - The tools page.
 * @returns The path.
 */
async function gamePath(page: Page): Promise<string> {
  try {
    const position = await readSource<{ path: string }>(page, "game.position");
    return position.path;
  } catch {
    return "pending";
  }
}

/**
 * The session id the hub gave the game page, "pending" while the page reloads.
 *
 * @param page - The tools page.
 * @returns The session id.
 */
async function sessionId(page: Page): Promise<string> {
  try {
    return await gameFrame(page).evaluate(
      () =>
        (
          Reflect.get(globalThis, "editor") as { bridge: { session(): string | undefined } }
        ).bridge.session() ?? "pending"
    );
  } catch {
    return "pending";
  }
}

/**
 * Answers the flow gate of the game, as a tap on a control would.
 *
 * @param page - The tools page.
 * @param intent - The intent.
 */
async function answer(page: Page, intent: string): Promise<void> {
  const took = await gameFrame(page).evaluate(
    value =>
      (
        Reflect.get(globalThis, "game") as {
          flow: { gate: { answer(a: { intent: string }): boolean } };
        }
      ).flow.gate.answer({ intent: value }),
    intent
  );
  expect(took, `the gate took ${intent}`).toBe(true);
}

/**
 * Marks the game page, so a reload shows as the mark being gone.
 *
 * @param page - The tools page.
 */
async function markGame(page: Page): Promise<void> {
  await gameFrame(page).evaluate(() => Reflect.set(globalThis, "__e2eMark", 1));
}

/**
 * Tells whether the game page was reloaded since `markGame`.
 *
 * @param page - The tools page.
 * @returns "reloaded", "marked" or "pending" (no page to ask, mid reload).
 */
async function reloadState(page: Page): Promise<string> {
  try {
    const marked = await gameFrame(page).evaluate(() => Reflect.get(globalThis, "__e2eMark") === 1);
    return marked ? "marked" : "reloaded";
  } catch {
    return "pending";
  }
}

/**
 * Starts recording every toast the tools page shows, in order.
 *
 * @param page - The tools page.
 */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = new WeakSet<Element>(document.querySelectorAll("[data-ui=toasts] [data-toast]"));
    const history: string[] = [];
    Reflect.set(globalThis, "__e2eToasts", history);
    const scan = (): void => {
      for (const toast of document.querySelectorAll("[data-ui=toasts] [data-toast]")) {
        if (seen.has(toast)) continue;
        seen.add(toast);
        history.push(toast.textContent ?? "");
      }
    };
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * The toasts shown since `recordToasts`, oldest first.
 *
 * @param page - The tools page.
 * @returns The toast texts.
 */
async function toastHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(Reflect.get(globalThis, "__e2eToasts") ?? [])].map(String));
}

/**
 * Starts the quiet recorder on the tools page: a `layout-shift` observer (buffered, every entry),
 * the spinner count on every mutation and every animation frame, and every element that turns
 * `data-tone="error"`. `startPhase` zeroes it.
 *
 * @param page - The tools page.
 */
async function recordQuiet(page: Page): Promise<void> {
  await page.evaluate(spinner => {
    const quiet = { shifts: [], spinnerMax: 0, spinnerShows: 0, errorTones: [], start: 0 } as {
      shifts: { value: number; input: boolean; moved: string[]; toast: boolean }[];
      spinnerMax: number;
      spinnerShows: number;
      errorTones: string[];
      start: number;
    };
    Reflect.set(globalThis, "__e2eQuiet", quiet);
    quiet.start = performance.now();

    // Every layout shift, also those after input: the Reload click must not move the editor.
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node: Node | null }[];
        };
        const sources = shift.sources ?? [];
        const moved = sources.map(({ node }) => {
          if (!(node instanceof HTMLElement)) return String(node?.nodeName);
          const name = node.dataset.ui ?? node.dataset.part ?? node.dataset.game ?? "";
          return `${node.tagName.toLowerCase()}[${name}] ${node.className}`;
        });
        const toast =
          sources.length > 0 &&
          sources.every(({ node }) => {
            const element = node instanceof Element ? node : node?.parentElement;
            return element?.closest("[data-ui=toasts]") !== null && element !== undefined;
          });
        quiet.shifts.push({ value: shift.value, input: shift.hadRecentInput, moved, toast });
      }
    }).observe({ type: "layout-shift", buffered: true });

    // The spinner: how many show at once, and how often it comes up.
    let showing = 0;
    const countSpinners = (): void => {
      const visible = [...document.querySelectorAll(spinner)].filter(element =>
        element.checkVisibility()
      ).length;
      if (visible > 0 && showing === 0) quiet.spinnerShows += 1;
      quiet.spinnerMax = Math.max(quiet.spinnerMax, visible);
      showing = visible;
    };

    // The red tone.
    const note = (element: Element): void => {
      const ms = Math.round(performance.now() - quiet.start);
      quiet.errorTones.push(`${ms} ms ${element.tagName} ${element.textContent ?? ""}`);
    };
    const scan = (node: Node): void => {
      if (!(node instanceof Element)) return;
      if (node.matches("[data-tone=error]")) note(node);
      for (const element of node.querySelectorAll("[data-tone=error]")) note(element);
    };
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes") scan(record.target);
        else for (const node of record.addedNodes) scan(node);
      }
      countSpinners();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tone", "hidden"]
    });
    const tick = (): void => {
      countSpinners();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SPINNER);
}

/**
 * Zeroes the quiet recorder for the next phase.
 *
 * @param page - The tools page.
 */
async function startPhase(page: Page): Promise<void> {
  await page.evaluate(() => {
    const quiet = Reflect.get(globalThis, "__e2eQuiet") as {
      shifts: unknown[];
      spinnerMax: number;
      spinnerShows: number;
      errorTones: string[];
      start: number;
    };
    quiet.shifts.length = 0;
    quiet.spinnerMax = 0;
    quiet.spinnerShows = 0;
    quiet.errorTones.length = 0;
    quiet.start = performance.now();
  });
}

/**
 * What the quiet recorder saw since `startPhase`.
 *
 * @param page - The tools page.
 * @returns The phase.
 */
async function readPhase(page: Page): Promise<Quiet> {
  return page.evaluate(() => {
    const quiet = Reflect.get(globalThis, "__e2eQuiet") as Quiet;
    return {
      shifts: quiet.shifts.map(shift => ({ ...shift, moved: [...shift.moved] })),
      spinnerMax: quiet.spinnerMax,
      spinnerShows: quiet.spinnerShows,
      errorTones: [...quiet.errorTones]
    };
  });
}

/**
 * Runs one reload phase and judges it: the act, then the wait until the reload is over (`done`,
 * a live link, no spinner, half a second of rest), then 0 layout shift, one spinner on the frame
 * during it, none after, and no red tone.
 *
 * @param page - The tools page.
 * @param name - The phase, for the messages.
 * @param act - Starts the reload.
 * @param done - Waits until the game is back.
 * @returns What the phase saw.
 */
async function quietPhase(
  page: Page,
  name: string,
  act: () => Promise<void>,
  done: () => Promise<void>
): Promise<Quiet> {
  await startPhase(page);
  await act();
  await done();
  await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
    timeout: RELOAD_MS
  });
  await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: RELOAD_MS });
  await page.waitForTimeout(500);

  // Every entry counts, after input too; only the toast stack, an overlay in the top layer that
  // grows as toasts come and go, is not the editor.
  const phase = await readPhase(page);
  const editor = phase.shifts.filter(shift => !shift.toast);
  const total = editor.reduce((sum, shift) => sum + shift.value, 0);
  expect(total, `${name}: layout shift ${JSON.stringify(phase.shifts)}`).toBe(0);
  expect(phase.spinnerShows, `${name}: the spinner showed`).toBeGreaterThanOrEqual(1);
  expect(phase.spinnerMax, `${name}: one spinner at a time`).toBe(1);
  expect(phase.errorTones, `${name}: no data-tone=error`).toEqual([]);
  await expect(page.locator(SPINNER)).toHaveCount(0);
  return phase;
}

/**
 * Appends a comment to a game source on disk (an outside save, as an agent makes one) and
 * returns the way to put the file back.
 *
 * @param file - The path relative to the game root.
 * @returns Writes the original text again.
 */
async function saveSource(file: string): Promise<() => Promise<void>> {
  const absolute = path.join(GAME_ROOT, file);
  const original = await readFile(absolute, "utf8");
  await writeFile(absolute, `${original}\n// e2e save ${Date.now()}\n`);
  return () => writeFile(absolute, original);
}

/**
 * Waits until the game page was reloaded since `markGame` and stands on a flow node again.
 *
 * @param page - The tools page.
 * @param at - The flow node it should stand on.
 */
async function reloadedAt(page: Page, at: string): Promise<void> {
  await expect.poll(() => reloadState(page), { timeout: RELOAD_MS }).toBe("reloaded");
  await expect.poll(() => gamePath(page), { timeout: RELOAD_MS }).toBe(at);
}

/**
 * A part of the Game toolbar.
 *
 * @param page - The tools page.
 * @param part - The data-part.
 * @returns The locator.
 */
function bar(page: Page, part: string): Locator {
  return page.locator(`[data-workspace-host=game] [data-game=toolbar] [data-part=${part}]`);
}

/**
 * Shows Game and waits for the frame to dock on the stage slot.
 *
 * @param tools - The driver.
 */
async function showGame(tools: Tools): Promise<void> {
  await tools.show("game");
  await expect(tools.page.locator("[data-frame-box]")).toHaveAttribute("data-docked", "stage");
}

/**
 * Every `key` in a `game.ui` tree.
 *
 * @param node - The tree, or one of its nodes.
 * @returns The keys, depth first.
 */
function keysOf(node: UiNode | UiNode[]): string[] {
  if (Array.isArray(node)) return node.flatMap(child => keysOf(child));
  const own = node.key === undefined ? [] : [node.key];
  return [...own, ...(node.children ?? []).flatMap(child => keysOf(child))];
}

/**
 * The node of a key in a `game.ui` tree.
 *
 * @param node - The tree, or one of its nodes.
 * @param key - The ui key.
 * @returns The node, undefined when no node carries the key.
 */
function nodeOf(node: UiNode | UiNode[], key: string): UiNode | undefined {
  if (Array.isArray(node)) {
    return node.map(child => nodeOf(child, key)).find(found => found !== undefined);
  }
  if (node.key === key) return node;
  return nodeOf(node.children ?? [], key);
}

/**
 * The style of a keyed node of `game.ui`, as JSON, "" while the page does not answer.
 *
 * @param page - The tools page.
 * @param key - The ui key.
 * @returns The style JSON.
 */
async function uiStyle(page: Page, key: string): Promise<string> {
  try {
    const ui = await readSource<UiNode | UiNode[]>(page, "game.ui");
    return JSON.stringify(nodeOf(ui, key)?.style ?? {});
  } catch {
    return "";
  }
}

/**
 * The rect of a keyed element once it stops moving.
 *
 * @param page - The tools page.
 * @param key - The ui key.
 * @returns The settled rect in game CSS px.
 */
async function settledRect(page: Page, key: string): Promise<Rect> {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await readSource<Rect | null>(page, "game.locate", { key }));
      const still = now === last && now !== "null";
      last = now;
      return still;
    })
    .toBe(true);
  return JSON.parse(last) as Rect;
}

/**
 * Maps a game rect to client px through the iframe box.
 *
 * @param page - The tools page.
 * @param rect - The rect in game CSS px.
 * @returns The rect in client px.
 */
async function toClient(page: Page, rect: Rect): Promise<Rect> {
  const box = await page.locator("iframe[data-game-frame]").boundingBox();
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
 * The mean luminance of the game frame as the screen shows it, 0 (black) to 255.
 *
 * @param page - The tools page.
 * @returns The mean luminance.
 */
async function frameLuma(page: Page): Promise<number> {
  const png = await page.locator("iframe[data-game-frame]").screenshot();
  return page.evaluate(async data => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    if (context === null) return 0;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      sum +=
        0.2126 * (pixels[index] ?? 0) +
        0.7152 * (pixels[index + 1] ?? 0) +
        0.0722 * (pixels[index + 2] ?? 0);
    }
    return sum / (pixels.length / 4);
  }, png.toString("base64"));
}

/**
 * The text on the clipboard.
 *
 * @param page - The tools page.
 * @returns The text.
 */
async function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * The reference block of a card file, in its `text` fence.
 *
 * @param card - The card path, relative to the game root.
 * @returns The block.
 */
async function blockOf(card: string): Promise<string> {
  const text = await readFile(path.join(GAME_ROOT, card), "utf8");
  const [, block = ""] = TEXT_FENCE.exec(text) ?? [];
  expect(block, text).not.toBe("");
  return block;
}

test.describe("only the game reloads · U9 U10", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.name !== "chromium-desktop",
      "what the spec measures does not depend on the window: once, on desktop"
    );
  });

  test.afterEach(async () => {
    await rm(path.join(GAME_ROOT, CAPTURES_DIR), { recursive: true, force: true });
  });

  test("Reload, Hot reload off and on, and a rules save: no layout shift on the tools page, one spinner on the frame, no red (B10)", async ({
    tools,
    errors
  }) => {
    test.setTimeout(180_000);
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    await recordQuiet(page);
    await recordToasts(page);

    // The toolbar Reload: a fresh start, back on home.
    await quietPhase(
      page,
      "Reload",
      async () => {
        await markGame(page);
        await bar(page, "reload").click();
      },
      () => reloadedAt(page, "home")
    );

    // A state a fresh start would lose: the board.
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");

    // The bin starts with hot reload on; every test leaves it on.
    expect(await barChecked(page, "hot-reload"), "hot reload on at the start").toBe(true);

    // Hot reload off, then on: the bin restarts, the frame reloads with the checkpoint.
    for (const state of ["off", "on"] as const) {
      await quietPhase(
        page,
        `Hot reload ${state}`,
        async () => {
          await markGame(page);
          await recordToasts(page);
          await flipBarToggle(page, "hot-reload");
        },
        async () => {
          await expect
            .poll(() => toastHistory(page), { timeout: RELOAD_MS })
            .toEqual([`Hot reload ${state}`, RESTORED]);
          await reloadedAt(page, "board/awaitIntent");
        }
      );
    }

    // A rules save: Bun reloads the page, the bridge restores the board.
    let putBack: (() => Promise<void>) | undefined;
    try {
      await quietPhase(
        page,
        "rules save",
        async () => {
          await markGame(page);
          putBack = await saveSource(RULES_FILE);
        },
        () => reloadedAt(page, "board/awaitIntent")
      );
    } finally {
      await putBack?.();
    }
    // Putting the file back is a save too.
    await markGame(page);
    await reloadedAt(page, "board/awaitIntent");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: RELOAD_MS
    });
    expect(errors.unexpected(), "no console error from the reloads").toEqual([]);
  });

  test("hot swap: a style save swaps in place (same session and page, toast Game updated, the new style in game.ui); a rules save reloads and restores the same node", async ({
    tools,
    errors
  }) => {
    test.setTimeout(120_000);
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");

    // Pick the Play button: its style card names playButton in features/home/styles.ts.
    await page.keyboard.press("r");
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.locator('[data-moku-proxy][data-moku-key="play"]').dispatchEvent("pointerup");
    await expect.poll(() => clipboard(page), { timeout: 15_000 }).toMatch(REFERENCE_LINE);
    await page.keyboard.press("r");
    const panel = page.locator('aside[data-side-panel="game.side"]');
    if ((await panel.getAttribute("data-state")) === "collapsed") {
      await panel.locator(":scope > [data-part=rail] [data-action=expand]").click();
    }
    const card = page.locator(
      "[data-workspace-host=game] [data-game=side] [data-part=element] [data-part=style-card]"
    );
    await expect(card.locator("[data-part=where]")).toHaveText(/^features\/home\/styles\.ts:\d+$/, {
      timeout: 20_000
    });
    const file = "features/home/styles.ts";
    const original = await readFile(path.join(GAME_ROOT, file), "utf8");

    const session = await sessionId(page);
    expect(session).toMatch(/^s-/);
    const styleBefore = await uiStyle(page, "play");
    expect(styleBefore).not.toBe("{}");
    try {
      await markGame(page);
      await recordToasts(page);
      await card
        .getByRole("button", { name: /^Increase / })
        .first()
        .click();

      // The game swaps the module: one toast, no reload, the same session, the new style.
      await expect
        .poll(() => toastHistory(page), { timeout: RELOAD_MS })
        .toEqual([`✓ Saved · ${file}`, UPDATED]);
      await expect.poll(() => readFile(path.join(GAME_ROOT, file), "utf8")).not.toBe(original);
      await expect.poll(() => uiStyle(page, "play")).not.toBe(styleBefore);
      expect(await reloadState(page), "the game page after a hot swap").toBe("marked");
      expect(await sessionId(page)).toBe(session);
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
    } finally {
      await writeFile(path.join(GAME_ROOT, file), original);
    }
    // Writing it back swaps again, still without a reload.
    await expect.poll(() => uiStyle(page, "play"), { timeout: RELOAD_MS }).toBe(styleBefore);
    expect(await reloadState(page)).toBe("marked");
    expect(await sessionId(page)).toBe(session);

    // A rules save: Bun reloads the page and the bridge restores the board in a new session.
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
    let putBack: (() => Promise<void>) | undefined;
    try {
      putBack = await saveSource(RULES_FILE);
      await reloadedAt(page, "board/awaitIntent");
      await expect.poll(() => sessionId(page), { timeout: RELOAD_MS }).toMatch(/^s-/);
      expect(await sessionId(page)).not.toBe(session);
      await markGame(page);
    } finally {
      await putBack?.();
    }
    await reloadedAt(page, "board/awaitIntent");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: RELOAD_MS
    });
  });

  test("popup restore: a rules save with Settings open over Home restores settings/open with Home under it, not a black frame", async ({
    tools,
    errors
  }) => {
    test.setTimeout(120_000);
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    await answer(page, "openSettings");
    await expect.poll(() => gamePath(page)).toMatch(/settings\/open$/);
    const at = await gamePath(page);
    await settledRect(page, "settingsBoard");
    const before = await frameLuma(page);

    let putBack: (() => Promise<void>) | undefined;
    try {
      await markGame(page);
      putBack = await saveSource(RULES_FILE);
      await reloadedAt(page, at);
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
        timeout: RELOAD_MS
      });

      // Home stays under the popup: both screens are in game.ui, the board settles on screen.
      const keys = keysOf(await readSource<UiNode | UiNode[]>(page, "game.ui"));
      expect(keys).toContain("homeScreen");
      expect(keys).toContain("settingsScreen");
      expect(keys).toContain("homeLogo");
      await settledRect(page, "settingsBoard");
      await expect(page.locator(SPINNER)).toHaveCount(0);
      const after = await frameLuma(page);
      expect(after, `luminance ${after} after, ${before} before`).toBeGreaterThan(before * 0.6);
      await markGame(page);
    } finally {
      await putBack?.();
    }
    await reloadedAt(page, at);
  });

  test('texts: an area card over the top of Home holds text "Лесной городок"; a pick of homeCoinsText carries value "0"', async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    await page.keyboard.press("r");
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");

    // A drag across the top of Home, from under the status bar at the left edge to just under
    // the logo sign at the right edge.
    const frame = await page.locator("iframe[data-game-frame]").boundingBox();
    if (frame === null) throw new Error("no iframe box");
    const logo = await toClient(page, await settledRect(page, "homeLogo"));
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.mouse.move(frame.x + frame.width * 0.03, frame.y + frame.height * 0.08);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width * 0.97, logo.y + logo.h + 6, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => clipboard(page), { timeout: 15_000 }).toMatch(AREA_LINE);
    const area = await blockOf(AREA_LINE.exec(await clipboard(page))?.[1] ?? "");
    expect(area).toContain('text "Лесной городок"');
    expect(area).toMatch(/ · key homeLogo · /);

    // One pick of the coin pill's words: the state line carries the value the game shows.
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page
      .locator('[data-moku-proxy][data-moku-key="homeCoinsText"]')
      .dispatchEvent("pointerup");
    await expect.poll(() => clipboard(page), { timeout: 15_000 }).toMatch(REFERENCE_LINE);
    const line = await clipboard(page);
    expect(REFERENCE_LINE.exec(line)?.[1]).toBe("homeCoinsText");
    const block = await blockOf(REFERENCE_LINE.exec(line)?.[2] ?? "");
    expect(block).toMatch(/^state: visible · .*value "0"/m);
  });
});
