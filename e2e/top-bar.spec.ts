/**
 * @file The compact top bar (round 2 R1, round 2b R15) at every window width the editor runs in:
 * 480, 600, 640, 720 and 899 px show the compact bar (logo, game name above 560 px, link pill,
 * Pause and Step as icons, the Reference mode icon toggle, above 560 px the Hot reload icon
 * toggle, the search icon and the ⋯ menu), 960 and 1440 px the wide one (session chip, the
 * labelled Preview, Overlay and Hot reload switches, Reference mode, Registry as an icon with its
 * counts in the title, theme). The test loops `page.setViewportSize` itself, so it runs once, in
 * the desktop project. At each width no two controls of the bar overlap (bounding boxes), every
 * control is on screen and takes the pointer at its centre, and every action works: from the bar
 * icons and the ⋯ menu below 900 px, from the bar from 900 px. The Game toolbar has no overlay
 * switch of its own any more; its switches are Safe area and Sound.
 *
 * Hot reload is a real switch (D-32): the bin restarts its server with Bun HMR flipped on the same
 * port, and the tools page reloads the game frame with the checkpoint it took first. Off: the page
 * `/` carries no `/_bun/client` script and a save on disk reloads nothing. On: the script is back
 * and a save reloads the game again. Every test that switches it leaves it on, as the bin started.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, gameRoot, type Tools, test } from "./fixtures";
import { closeMore, isCompact, moreMenu, openMore, topBar } from "./top-bar";

/**
 * A game source the save checks touch: an appended comment changes nothing the game shows. A
 * logic module, so Bun reloads the page; a view module would hot swap in place (game 0.5.0, U10).
 */
const SAVED_SOURCE = "rules.ts";

/** The script Bun's HMR client adds to the HTML of a page served with HMR on. */
const HMR_CLIENT = "/_bun/client";

/** The tooltip of the Hot reload control while the bin serves with HMR on. */
const HOT_ON_TITLE = "Hot reload (H): on · Bun reloads the game after a save and keeps its state";

/** The tooltip of the Hot reload control while the bin serves with HMR off. */
const HOT_OFF_TITLE = "Hot reload (H): off · a save does not reload the game";

/** The toast of the frame reload that follows an accepted switch. */
const RESTORED = "Game reloaded · state restored from the last checkpoint";

/**
 * What a switch provokes on purpose. The bin restarts its server (D-32): the hub closes every
 * editor socket with 1012 first, and the bridge and link log that at info (U11). Only Bun's HMR
 * client is out of our hands: on the page served with HMR on it reports its socket gone and retries
 * it (404 once HMR is off) until the frame reload replaces the page. A scene read the tools page
 * had in flight still fails until gameView logs those at debug.
 */
const SWITCH_WARNINGS: readonly RegExp[] = [
  /WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/_bun\/hmr' failed/,
  /^\[Bun\] Hot-module-reloading socket disconnected, reconnecting\.\.\.$/,
  // The engine's asset warnings while a reloaded frame loads its bundle (game-release-brief item 6).
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/**
 * What a game reload can provoke on the tools page while the tools page talks to the old page:
 * a watch or the manifest fetch it sent in that moment is refused with -32001 `game_reloaded`,
 * which link logs at error when it did not expect the reload (a save under Bun HMR), and the Files
 * graph read in flight fails. The tiny game reloads fast enough to hit that window about one run in
 * three. Allowed only in the tests that switch hot reload or save a game source.
 */
const RELOAD_RACE_LOGS: readonly RegExp[] = [
  /event: link:watch-failed/,
  /event: link:manifest-failed/,
  /event: filesView:graph-failed/
];

/** How long one switch may take: the restart, both reconnects and the frame reload. */
const SWITCH_MS = 30_000;

/** The window widths of the spec, in px; the height stays 900. */
const WIDTHS = [480, 600, 640, 720, 899, 960, 1440] as const;

/** At this width and narrower the compact bar keeps only the Reference icon toggle (R15). */
const NARROW_BAR_MAX = 560;

/** The compact widths. */
const COMPACT_WIDTHS = WIDTHS.filter(width => width < 900);

/** The wide widths. */
const WIDE_WIDTHS = WIDTHS.filter(width => width >= 900);

/** The ⋯ menu rows in order, with the key a toggle row shows. */
const MENU_ROWS = [
  { action: "game", label: "Game preview", key: "G" },
  { action: "overlay", label: "Overlay in game", key: "O" },
  { action: "reference", label: "Reference mode", key: "R" },
  { action: "hot-reload", label: "Hot reload", key: "H" },
  { action: "registry", label: "Registry", key: undefined },
  { action: "density", label: "Density", key: undefined },
  { action: "theme", label: "Theme", key: undefined }
] as const;

/** One direct child of the top bar, measured in the page. */
type BarItem = {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly hit: boolean;
};

/**
 * Measures the visible direct children of the top bar (closed popovers are not children that
 * show) and whether each one is the topmost element at its centre.
 *
 * @param page - The tools page.
 * @returns The overflow of the bar in px and the items, left to right.
 */
async function measureBar(page: Page): Promise<{ overflow: number; items: BarItem[] }> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-ui=top-bar]");
    const children = bar === null ? [] : [...bar.children];
    const items = children
      .filter(child => child.checkVisibility() && !child.matches("[popover]"))
      .map(child => {
        const element = child as HTMLElement;
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        const data = element.dataset;
        const name =
          data.action ??
          data.ui ??
          (data.search === undefined ? undefined : "search") ??
          (data.gameName === undefined ? undefined : "game-name") ??
          (data.logo === undefined ? undefined : "logo") ??
          element.tagName.toLowerCase();
        return {
          name,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          hit: hit !== null && element.contains(hit)
        };
      });
    return { overflow: bar === null ? -1 : bar.scrollWidth - bar.clientWidth, items };
  });
}

/**
 * Judges the bar: no overflow, every item on screen and taking the pointer, no two items sharing
 * more than half a pixel on both axes.
 *
 * @param page - The tools page.
 * @param width - The window width.
 * @returns The item names left to right and the findings (empty when the bar is fine).
 */
async function judgeBar(
  page: Page,
  width: number
): Promise<{ names: string[]; findings: string[] }> {
  const { overflow, items } = await measureBar(page);
  const findings = overflow > 0 ? [`the bar overflows by ${overflow}px`] : [];
  for (const item of items) {
    if (item.left < 0 || item.right > width) findings.push(`${item.name} off screen`);
    if (!item.hit) findings.push(`${item.name} is covered at its centre`);
  }
  for (const [index, a] of items.entries()) {
    for (const b of items.slice(index + 1)) {
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 0.5 && y > 0.5) findings.push(`${a.name} overlaps ${b.name} by ${x.toFixed(1)}px`);
    }
  }
  return { names: items.map(item => item.name), findings };
}

/**
 * Sets the window width (900 px tall) and waits for the bar's layout of that width.
 *
 * @param tools - The driver.
 * @param width - The window width.
 */
async function resize(tools: Tools, width: number): Promise<void> {
  await tools.page.setViewportSize({ width, height: 900 });
  await expect(topBar(tools.page)).toHaveAttribute("data-layout", width < 900 ? "compact" : "wide");
  await tools.settle();
}

/**
 * The newest toast.
 *
 * @param page - The tools page.
 * @returns Its text.
 */
function lastToast(page: Page) {
  return page.locator("[data-ui=toasts] [data-toast]").last();
}

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
 * The game position path, "pending" while the page reloads.
 *
 * @param page - The tools page.
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
 * Waits until the game page's own clock has run `ms` on in the document `markGame` marked. A
 * reload in that time drops the mark, so the wait cannot end and fails.
 *
 * @param page - The tools page.
 * @param ms - How long the game must keep its page.
 */
async function gameKeepsPageFor(page: Page, ms: number): Promise<void> {
  const frame = gameFrame(page);
  const until = (await frame.evaluate(() => performance.now())) + ms;
  await frame.waitForFunction(
    end => Reflect.get(globalThis, "__e2eMark") === 1 && performance.now() >= end,
    until,
    { timeout: ms + SWITCH_MS }
  );
}

/**
 * Starts recording every toast the tools page shows, in order: a switch toasts its state and the
 * frame reload toasts right after it, faster than a locator poll.
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
 * Whether the page `/` the bin serves carries Bun's HMR client script.
 *
 * @param page - The tools page (its request context and base URL).
 * @returns True with HMR on.
 */
async function servesHmrClient(page: Page): Promise<boolean> {
  const response = await page.request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  return html.includes(HMR_CLIENT);
}

/**
 * Flips Hot reload with a click on a control and waits for the whole switch: the toast of the new
 * state, the frame reloaded with the checkpoint (the game stands where it stood, which a fresh
 * start would not), a live link and the page `/` with or without Bun's HMR client.
 *
 * @param page - The tools page.
 * @param control - The switch, the bar icon or the ⋯ menu row.
 * @param on - The state the click asks for.
 */
async function switchHotReload(page: Page, control: Locator, on: boolean): Promise<void> {
  const before = await gamePath(page);
  expect(before).not.toBe("home");
  await markGame(page);
  await recordToasts(page);
  await control.click();

  const state = on ? "on" : "off";
  await expect.poll(() => toastHistory(page), { timeout: SWITCH_MS }).toContain(RESTORED);
  const toasts = await toastHistory(page);
  expect(toasts.indexOf(`Hot reload ${state}`), toasts.join(" | ")).toBe(0);
  expect(toasts.indexOf(RESTORED), toasts.join(" | ")).toBeGreaterThan(0);
  expect(await reloadState(page)).toBe("reloaded");
  await expect.poll(() => gamePath(page)).toBe(before);
  await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
    timeout: SWITCH_MS
  });
  expect(await servesHmrClient(page), `/ with hot reload ${state}`).toBe(on);
}

/**
 * Starts recording, on the tools page, every element that shows `data-tone="error"`: added, or
 * an attribute that turns to it, with its ms since the start and its text (U7).
 *
 * @param page - The tools page.
 */
async function recordErrorTones(page: Page): Promise<void> {
  await page.evaluate(() => {
    const start = performance.now();
    const seen: string[] = [];
    Reflect.set(globalThis, "__e2eErrorTones", seen);
    const note = (element: Element): void => {
      const ms = Math.round(performance.now() - start);
      seen.push(`${ms} ms ${element.tagName} ${element.textContent ?? ""}`);
    };
    const scan = (node: Node): void => {
      if (!(node instanceof Element)) return;
      if (node.matches("[data-tone=error]")) note(node);
      for (const element of node.querySelectorAll("[data-tone=error]")) note(element);
    };
    for (const element of document.querySelectorAll("[data-tone=error]")) note(element);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes") scan(record.target);
        else for (const node of record.addedNodes) scan(node);
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tone"]
    });
  });
}

/**
 * The `data-tone="error"` elements seen since `recordErrorTones`.
 *
 * @param page - The tools page.
 * @returns One line per element: ms, tag and text.
 */
async function errorTones(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(Reflect.get(globalThis, "__e2eErrorTones") ?? [])].map(String));
}

/**
 * Appends a comment to a game source on disk (an outside save, as an agent makes one) and
 * returns the way to put the file back.
 *
 * @returns Writes the original text again.
 */
async function saveSource(): Promise<() => Promise<void>> {
  const file = path.join(gameRoot(), SAVED_SOURCE);
  const original = await readFile(file, "utf8");
  await writeFile(file, `${original}\n// e2e save ${Date.now()}\n`);
  return () => writeFile(file, original);
}

/**
 * A row of the ⋯ menu by its data-action (the menu renders its rows only while it is open).
 *
 * @param page - The tools page.
 * @param action - The data-action.
 * @returns The locator.
 */
function menuRow(page: Page, action: string) {
  return moreMenu(page).locator(`[data-action="${action}"]`);
}

/**
 * Expects Pause and Step of the compact bar to show their icon only (R15): no visible label text,
 * the label still their accessible name.
 *
 * @param page - The tools page.
 * @param width - The window width, for the messages.
 */
async function expectIconButtons(page: Page, width: number): Promise<void> {
  for (const [action, name] of [
    ["pause", "Pause"],
    ["step", "Step 1 frame"]
  ] as const) {
    const button = topBar(page).locator(`:scope > [data-action=${action}]`);
    await expect(button.locator("svg")).toHaveCount(1);
    const shown = await button.evaluate(element =>
      [...element.querySelectorAll("span")]
        .filter(span => span.checkVisibility() && span.dataset.srOnly === undefined)
        .map(span => span.textContent)
        .join("")
    );
    expect(shown, `${action} label at ${width} px`).toBe("");
    await expect(topBar(page).getByRole("button", { name, exact: true })).toBeVisible();
  }
}

test.describe("top bar · round 2", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.name !== "chromium-desktop",
      "the spec sets every window width itself"
    );
  });

  test("480 / 600 / 640 / 720 / 899 / 960 / 1440: no two controls overlap, each is on screen and takes the pointer", async ({
    tools
  }) => {
    const page = tools.page;
    for (const width of WIDTHS) {
      await resize(tools, width);
      const { names, findings } = await judgeBar(page, width);
      expect(findings, `top bar at ${width} px`).toEqual([]);

      const compact = width < 900;
      const expected = compact
        ? [
            "logo",
            ...(width > 560 ? ["game-name"] : []),
            "link-pill",
            "pause",
            "step",
            "reference",
            ...(width > NARROW_BAR_MAX ? ["hot-reload"] : []),
            "search",
            "more"
          ]
        : [
            "logo",
            "game-name",
            "session-chip",
            "link-pill",
            "pause",
            "step",
            "search",
            "game",
            "overlay",
            "hot-reload",
            "reference",
            "registry",
            "theme"
          ];
      expect(names, `controls at ${width} px`).toEqual(expected);
      // Compact: Pause and Step are icons; their labels stay the accessible names.
      if (compact) await expectIconButtons(page, width);
      // The search never shrinks under its content: the wide box keeps 88 px, the icon 28.
      const search = await topBar(page).locator("[data-search]").boundingBox();
      expect(search?.width ?? 0, `search at ${width} px`).toBeGreaterThanOrEqual(compact ? 28 : 88);
      // No page scroll sideways.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
        `page overflow at ${width} px`
      ).toBe(0);
    }

    // The Game toolbar lost its overlay switch: the top bar holds the only one.
    await tools.show("game");
    const toolbar = page.locator("[data-workspace-host=game] [data-game=toolbar]");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator("[data-part=overlay]")).toHaveCount(0);
    await expect(toolbar.getByRole("switch")).toHaveText(["Safe area", "Sound"]);
  });

  test("below 900 px the Reference and Hot reload icons act from the bar, and stay in the ⋯ menu", async ({
    tools,
    errors
  }) => {
    const page = tools.page;
    for (const width of COMPACT_WIDTHS) {
      await resize(tools, width);
      await tools.show("game");
      const bar = topBar(page);

      // Reference mode: a target icon, aria-pressed, the key in its title.
      const reference = bar.locator(":scope > [data-action=reference]");
      await expect(reference).toBeVisible();
      await expect(reference).toHaveAccessibleName("Reference mode");
      await expect(reference).toHaveAttribute("title", /\(R\)/);
      await expect(reference).toHaveAttribute("aria-pressed", "false");
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
      // The ⋯ row mirrors it.
      await openMore(page);
      await expect(menuRow(page, "reference")).toHaveAttribute("aria-checked", "true");
      await closeMore(page);
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("[data-frame-box]")).not.toHaveAttribute("data-reference", "");

      // Hot reload: a bar icon with a dot while on, above 560 px; a ⋯ row always.
      const hot = bar.locator(":scope > [data-action=hot-reload]");
      if (width <= NARROW_BAR_MAX) {
        await expect(hot).toHaveCount(0);
      } else {
        await expect(hot).toBeVisible();
        await expect(hot).toHaveAccessibleName("Hot reload");
        await expect(hot).toHaveAttribute("aria-pressed", "true");
        await expect(hot).toHaveAttribute("title", HOT_ON_TITLE);
        await expect(hot.locator("[data-part=dot]")).toHaveCount(1);
      }
      await openMore(page);
      await expect(menuRow(page, "hot-reload")).toHaveAttribute("aria-checked", "true");
      await closeMore(page);
    }

    // The icon switches hot reload off, the ⋯ row on again; each switch reloads the game frame
    // with its state (D-32). Once, at 600 px: a switch restarts the bin's server.
    for (const pattern of [...SWITCH_WARNINGS, ...RELOAD_RACE_LOGS]) errors.allow(pattern);
    await resize(tools, 600);
    await expect.poll(() => gamePath(page)).toBe("home");
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("level");
    const hot = topBar(page).locator(":scope > [data-action=hot-reload]");
    await switchHotReload(page, hot, false);
    await expect(hot).toHaveAttribute("aria-pressed", "false");
    await expect(hot).toHaveAttribute("title", HOT_OFF_TITLE);
    await expect(hot.locator("[data-part=dot]")).toHaveCount(0);
    await openMore(page);
    await expect(menuRow(page, "hot-reload")).toHaveAttribute("aria-checked", "false");
    await switchHotReload(page, menuRow(page, "hot-reload"), true);
    await openMore(page);
    await expect(menuRow(page, "hot-reload")).toHaveAttribute("aria-checked", "true");
    await closeMore(page);
    await expect(hot).toHaveAttribute("aria-pressed", "true");
    await expect(hot.locator("[data-part=dot]")).toHaveCount(1);
  });

  test("below 900 px the ⋯ menu holds every action, and each one works", async ({
    tools,
    errors
  }) => {
    const page = tools.page;
    const html = page.locator("html");
    const card = gameFrame(page).locator("[data-moku-editor-overlay]");
    for (const width of COMPACT_WIDTHS) {
      await resize(tools, width);
      await tools.show("game");
      expect(await isCompact(page)).toBe(true);
      const menu = moreMenu(page);

      // The rows in order, each with its label, its state and (a toggle) its key.
      await openMore(page);
      await expect(menu).toHaveAttribute("role", "menu");
      await expect(menu.locator("[role^=menuitem]")).toHaveCount(MENU_ROWS.length);
      for (const [index, { action, label, key }] of MENU_ROWS.entries()) {
        const item = menu.locator("[role^=menuitem]").nth(index);
        await expect(item).toHaveAttribute("data-action", action);
        await expect(item.locator("[data-part=label]")).toHaveText(label);
        await expect(item.locator("[data-part=state]")).not.toBeEmpty();
        if (key !== undefined) await expect(item.locator("kbd")).toHaveText(key);
      }
      // The menu sits inside the window.
      const box = await menu.boundingBox();
      expect(box?.x ?? -1, `menu left at ${width} px`).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0), `menu right at ${width} px`).toBeLessThanOrEqual(
        width
      );

      // Game preview: inert in Game, which always shows the game.
      await expect(menuRow(page, "game")).toHaveAttribute("aria-disabled", "true");
      await expect(menuRow(page, "game")).toHaveAttribute("aria-checked", "true");

      // Overlay in game: on and off, the menu stays open.
      await expect(menuRow(page, "overlay")).toHaveAttribute("aria-checked", "false");
      await menuRow(page, "overlay").click();
      await expect(menuRow(page, "overlay")).toHaveAttribute("aria-checked", "true");
      await expect(menuRow(page, "overlay").locator("[data-part=state]")).toHaveText("on");
      await expect(lastToast(page)).toContainText("Overlay in game on");
      await expect(card).toBeVisible();
      await expect(menu).toBeVisible();
      await menuRow(page, "overlay").click();
      await expect(menuRow(page, "overlay")).toHaveAttribute("aria-checked", "false");
      await expect(lastToast(page)).toContainText("Overlay in game off");
      await expect(card).toBeHidden();

      // Reference mode: the frame box takes the pointer while it is on.
      await menuRow(page, "reference").click();
      await expect(menuRow(page, "reference")).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
      await menuRow(page, "reference").click();
      await expect(menuRow(page, "reference")).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("[data-frame-box]")).not.toHaveAttribute("data-reference", "");

      // Hot reload: the bin serves with Bun HMR on (the row switches it: the icon test above).
      await expect(menuRow(page, "hot-reload")).toHaveAttribute("aria-checked", "true");
      await expect(menuRow(page, "hot-reload").locator("[data-part=state]")).toHaveText("on");
      await expect(menuRow(page, "hot-reload")).toHaveAttribute("title", HOT_ON_TITLE);

      // Density cycles auto → compact → comfortable → auto.
      await expect(menuRow(page, "density").locator("[data-part=state]")).toHaveText("auto");
      // Auto is compact below 820 px of window width.
      const auto = width < 820 ? "compact" : "comfortable";
      for (const [value, applied] of [
        ["compact", "compact"],
        ["comfortable", "comfortable"],
        ["auto", auto]
      ] as const) {
        await openMore(page);
        await menuRow(page, "density").click();
        await openMore(page);
        await expect(menuRow(page, "density").locator("[data-part=state]")).toHaveText(value);
        await expect(html).toHaveAttribute("data-density", applied);
      }

      // Theme flips light, then dark again.
      await openMore(page);
      await expect(menuRow(page, "theme").locator("[data-part=state]")).toHaveText("dark");
      await menuRow(page, "theme").click();
      await expect(html).toHaveAttribute("data-theme", "light");
      await openMore(page);
      await expect(menuRow(page, "theme").locator("[data-part=state]")).toHaveText("light");
      await menuRow(page, "theme").click();
      await expect(html).toHaveAttribute("data-theme", "dark");

      // Registry opens the registry popover under ⋯, inside the window.
      await openMore(page);
      await expect(menuRow(page, "registry").locator("[data-part=state]")).toHaveText("20 · 23");
      await menuRow(page, "registry").click();
      const registry = page.locator("[data-ui=registry-popover]");
      await expect(registry).toBeVisible();
      const popover = await registry.boundingBox();
      expect(popover?.x ?? -1, `registry left at ${width} px`).toBeGreaterThanOrEqual(0);
      expect(
        (popover?.x ?? 0) + (popover?.width ?? 0),
        `registry right at ${width} px`
      ).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(registry).toBeHidden();

      // Game preview where it acts: Render hides and shows the pinned preview.
      await closeMore(page);
      await tools.show("render");
      await openMore(page);
      await expect(menuRow(page, "game")).toHaveAttribute("aria-disabled", "false");
      const shown = (await menuRow(page, "game").getAttribute("aria-checked")) === "true";
      await menuRow(page, "game").click();
      await expect(menuRow(page, "game")).toHaveAttribute("aria-checked", String(!shown));
      await expect(page.locator("[data-ui=preview]")).toBeVisible({ visible: !shown });
      await menuRow(page, "game").click();
      await expect(menuRow(page, "game")).toHaveAttribute("aria-checked", String(shown));

      // Closing: Esc, a second ⋯ click and a press outside.
      await closeMore(page);
      const more = topBar(page).locator("[data-action=more]");
      await more.click();
      await expect(menu).toBeVisible();
      await more.click();
      await expect(menu).toBeHidden();
      await more.click();
      await expect(menu).toBeVisible();
      await page.locator("[data-shell-main]").click({ position: { x: 4, y: 4 } });
      await expect(menu).toBeHidden();

      // The keyboard: Enter on ⋯ focuses the first row, ↓ the next.
      await more.focus();
      await page.keyboard.press("Enter");
      await expect(menu.locator("[role^=menuitem]").first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.locator("[role^=menuitem]").nth(1)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      // The controls left in the bar: search, Pause and Step.
      await topBar(page).locator("[data-search]").click();
      await expect(page.locator("dialog[data-ui=palette]")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[data-ui=palette]")).toBeHidden();
      await topBar(page).locator("[data-action=pause]").click();
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");
      await expect(topBar(page).locator("[data-action=step]")).toHaveAttribute(
        "aria-disabled",
        "false"
      );
      await topBar(page).locator("[data-action=pause]").click();
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
      // The session moved into the pill's tooltip.
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute(
        "title",
        /session s-[0-9a-f]{4}/
      );
    }
    expect(errors.unexpected(), "no console error from any action").toEqual([]);
  });

  test("from 900 px the bar shows the labelled switches, Registry as an icon, and every action works", async ({
    tools,
    errors
  }) => {
    const page = tools.page;
    const bar = topBar(page);
    const html = page.locator("html");
    const card = gameFrame(page).locator("[data-moku-editor-overlay]");
    for (const width of WIDE_WIDTHS) {
      await resize(tools, width);
      await tools.show("game");
      await expect(bar.locator("[data-action=more]")).toHaveCount(0);
      for (const name of ["Preview", "Overlay", "Hot reload"]) {
        await expect(bar.getByRole("switch", { name, exact: true })).toBeVisible();
        await expect(bar.getByText(name, { exact: true })).toBeVisible();
      }
      // Registry: the icon only, the counts in its title.
      const registryButton = bar.locator(":scope > [data-action=registry]");
      await expect(registryButton).toHaveAttribute("title", "Registry · 20 sources · 23 commands");
      await expect(registryButton).toHaveAccessibleName("Registry");

      const overlay = bar.getByRole("switch", { name: "Overlay", exact: true });
      await overlay.click();
      await expect(overlay).toHaveAttribute("aria-checked", "true");
      await expect(lastToast(page)).toContainText("Overlay in game on");
      await expect(card).toBeVisible();
      await overlay.click();
      await expect(overlay).toHaveAttribute("aria-checked", "false");
      await expect(card).toBeHidden();

      const reference = bar.locator(":scope > [data-action=reference]");
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "false");

      // Hot reload is on (the switch acts: the Hot reload test below).
      const hot = bar.getByRole("switch", { name: "Hot reload", exact: true });
      await expect(hot).toHaveAttribute("aria-checked", "true");
      await expect(hot).toHaveAttribute("title", HOT_ON_TITLE);

      await registryButton.click();
      await expect(page.locator("[data-ui=registry-popover]")).toBeVisible();
      await registryButton.click();
      await expect(page.locator("[data-ui=registry-popover]")).toBeHidden();

      const theme = bar.locator(":scope > [data-action=theme]");
      await theme.click();
      await expect(html).toHaveAttribute("data-theme", "light");
      await theme.click();
      await expect(html).toHaveAttribute("data-theme", "dark");

      // Preview acts outside Game.
      const preview = bar.getByRole("switch", { name: "Preview", exact: true });
      await expect(preview).toHaveAttribute("aria-disabled", "true");
      await tools.show("render");
      await expect(preview).toHaveAttribute("aria-disabled", "false");
      const shown = (await preview.getAttribute("aria-checked")) === "true";
      await preview.click();
      await expect(preview).toHaveAttribute("aria-checked", String(!shown));
      await preview.click();
      await expect(preview).toHaveAttribute("aria-checked", String(shown));
    }
    expect(errors.unexpected(), "no console error from any action").toEqual([]);
  });

  test("Hot reload: the switch turns Bun HMR off and on, the game reloads with its state each time, and a save reloads it only while on", async ({
    tools,
    errors
  }) => {
    for (const pattern of [...SWITCH_WARNINGS, ...RELOAD_RACE_LOGS]) errors.allow(pattern);
    const page = tools.page;
    await resize(tools, 1440);
    await tools.show("game");
    const hot = topBar(page).getByRole("switch", { name: "Hot reload", exact: true });
    await expect(hot).toHaveAttribute("aria-checked", "true");
    expect(await servesHmrClient(page), "/ with hot reload on").toBe(true);

    // A state a fresh start would lose: the level.
    await expect.poll(() => gamePath(page)).toBe("home");
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("level");

    // Off: the bin serves without HMR; the frame reloads on the level.
    await switchHotReload(page, hot, false);
    await expect(hot).toHaveAttribute("aria-checked", "false");
    await expect(hot).toHaveAttribute("title", HOT_OFF_TITLE);

    // A save on disk reloads nothing while it is off.
    await markGame(page);
    const putBack = await saveSource();
    try {
      await gameKeepsPageFor(page, 3000);
      expect(await reloadState(page), "the game after a save with hot reload off").toBe("marked");
    } finally {
      await putBack();
    }
    await gameKeepsPageFor(page, 1000);
    expect(await reloadState(page)).toBe("marked");

    // On: the bin serves with HMR again; the frame reloads on the level.
    await switchHotReload(page, hot, true);
    await expect(hot).toHaveAttribute("aria-checked", "true");
    await expect(hot).toHaveAttribute("title", HOT_ON_TITLE);

    // A save reloads the game again, and the bridge restores the level; so does putting the file
    // back.
    await markGame(page);
    const putBackAgain = await saveSource();
    try {
      await expect.poll(() => reloadState(page), { timeout: SWITCH_MS }).toBe("reloaded");
      await expect.poll(() => gamePath(page), { timeout: SWITCH_MS }).toBe("level");
      await markGame(page);
    } finally {
      await putBackAgain();
    }
    await expect.poll(() => reloadState(page), { timeout: SWITCH_MS }).toBe("reloaded");
    await expect.poll(() => gamePath(page), { timeout: SWITCH_MS }).toBe("level");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: SWITCH_MS
    });
    expect(errors.unexpected(), "no console error from the switches").toEqual([]);
  });

  test("Hot reload: the switch is an expected reload, no red flash on the tools page (U7)", async ({
    tools,
    errors
  }) => {
    for (const pattern of [...SWITCH_WARNINGS, ...RELOAD_RACE_LOGS]) errors.allow(pattern);
    const page = tools.page;
    await resize(tools, 1440);
    await tools.show("game");
    const hot = topBar(page).getByRole("switch", { name: "Hot reload", exact: true });
    await expect(hot).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => gamePath(page)).toBe("home");
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("level");

    // Off and on again: the restart (close 1012), both reconnects and the frame reloads.
    await recordErrorTones(page);
    await switchHotReload(page, hot, false);
    await switchHotReload(page, hot, true);
    await expect(hot).toHaveAttribute("aria-checked", "true");

    expect(await errorTones(page), "no data-tone=error during the switches").toEqual([]);
    expect(errors.unexpected(), "no console error from the switches").toEqual([]);
  });

  test("the compact bar icons look right at 720 and 480 px (golden)", async ({ tools }) => {
    const page = tools.page;
    for (const width of [720, 480]) {
      await resize(tools, width);
      await expect(topBar(page)).toHaveScreenshot(`compact-bar-${width}.png`, {
        mask: [page.locator("[data-ui=link-pill]"), topBar(page).locator("[data-game-name]")]
      });
    }
  });
});
