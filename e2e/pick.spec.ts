/**
 * @file A pick for the chat (round 2 R2) on the frozen merge-game: a picker click on the settings
 * board (opened from the board's HUD) bookmarks the game, saves the cropped element and the full
 * frame under .moku/captures of the game copy, puts the reference block on the clipboard (its
 * eleven lines in the fixed order) and toasts "Reference, shot and bookmark copied". The Element
 * tab shows the same block. Restoring the pick's bookmark from a fresh start brings the game back
 * to board/settings/open. In Reference mode the proxies carry the frame, the reference bounds and,
 * once a pick found it, the style source; a key built in a loop (card0) resolves to its template
 * literal. Shot and Series put their paths on the clipboard too.
 *
 * The bookmark value is read off the tools page's socket: the answer to the tools' own
 * `game.bookmark` run, as the hub sent it. The restore runs `game.restore` with that value through
 * the game page's registry, the door the editor's `panels.run("game.restore")` reaches.
 */
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, openTools, type Tools, test } from "./fixtures";

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The captures folder of gameView, relative to the game root. */
const CAPTURES_DIR = ".moku/captures";

/** The labels of the block's lines, in their fixed order ("@moku" for the head). */
const BLOCK_ORDER = [
  "@moku",
  "path",
  "source",
  "layout",
  "bounds",
  "state",
  "flow",
  "game",
  "device",
  "restore",
  "shot"
] as const;

/** Game-frame warnings a reload provokes that are not editor defects (see flow.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** A bookmark the tools page took, as its socket received it. */
type Taken = { readonly frame: number; readonly value: unknown };

/** The JSON-RPC message fields this spec reads off the socket. */
type Message = {
  readonly id?: number;
  readonly method?: string;
  readonly params?: { readonly id?: string };
  readonly result?: { readonly value?: unknown; readonly state?: { readonly frame?: number } };
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
 * Runs a registry command of the game page directly.
 *
 * @param page - The test page.
 * @param id - The command id.
 * @param input - The command input.
 */
async function runCommand(page: Page, id: string, input: object): Promise<void> {
  await gameFrame(page).evaluate(
    async ([command, value]) => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { command(id: string): { run(input: object): Promise<unknown> } };
        }
      ).registry;
      await registry.command(command).run(value);
    },
    [id, input] as const
  );
}

/**
 * The game position path, "pending" while the page reloads.
 *
 * @param page - The test page.
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
 * Answers the flow gate of the game, as a tap on a control would.
 *
 * @param page - The test page.
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
 * The rect of a keyed element once it stops moving (the popup plays its entrance first).
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The settled rect in game CSS px.
 */
async function settledRect(page: Page, key: string): Promise<Rect> {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await readSource<Rect | null>(page, "game.rect", { key }));
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
 * @param page - The test page.
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
 * A part of the Game toolbar.
 *
 * @param page - The test page.
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
  const page = tools.page;
  await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-docked", "stage");
  await expect
    .poll(async () => {
      const slot = await page.locator("[data-workspace-host=game] [data-part=slot]").boundingBox();
      const frame = await page.locator("iframe[data-game-frame]").boundingBox();
      return slot !== null && frame !== null && Math.abs(slot.x - frame.x) < 1.5;
    })
    .toBe(true);
}

/**
 * Picks the first point of a grid over a client rect whose hover label matches, with a click.
 *
 * @param page - The test page.
 * @param rect - The client rect.
 * @param label - The expected hover label.
 */
async function pickIn(page: Page, rect: Rect, label: RegExp): Promise<void> {
  await bar(page, "pick").click();
  await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "true");
  const hover = page.locator("[data-game=overlay] [data-part=label]");
  let found: { x: number; y: number } | undefined;
  await expect
    .poll(
      async () => {
        for (const fy of [0.5, 0.62, 0.38, 0.75, 0.88, 0.25, 0.96]) {
          for (const fx of [0.04, 0.96, 0.5, 0.25, 0.75]) {
            const at = { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy };
            await page.mouse.move(at.x, at.y);
            const text = (await hover.count()) > 0 ? ((await hover.textContent()) ?? "") : "";
            if (label.test(text)) {
              found = at;
              return text;
            }
          }
        }
        return "";
      },
      { timeout: 20_000 }
    )
    .toMatch(label);
  if (found === undefined) throw new Error("no point");
  await page.mouse.click(found.x, found.y);
  await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");
}

/**
 * Shows the Element panel's content: below 600 px it is a drawer that starts collapsed.
 *
 * @param page - The test page.
 */
async function expandSide(page: Page): Promise<void> {
  const panel = page.locator('aside[data-side-panel="game.side"]');
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate(element => {
        const width = element.parentElement?.getBoundingClientRect().width ?? 0;
        return width > 0 && width < 600 === (element.dataset.overlay !== undefined);
      })
    )
    .toBe(true);
  if ((await panel.getAttribute("data-state")) === "collapsed") {
    await panel.locator(":scope > [data-part=rail] [data-action=expand]").click();
  }
  await expect(panel).toHaveAttribute("data-state", "expanded");
}

/**
 * The newest toast.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function toast(page: Page): Locator {
  return page.locator("[data-ui=toasts] [data-toast]").last();
}

/**
 * The text on the clipboard.
 *
 * @param page - The test page.
 * @returns The text.
 */
async function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Picks an element through its Reference mode proxy (a click on a proxy is its pointerup) and
 * waits for its block on the clipboard, emptied first.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The block.
 */
async function pickProxy(page: Page, key: string): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.locator(`[data-moku-proxy][data-moku-key="${key}"]`).dispatchEvent("pointerup");
  await expect
    .poll(() => clipboard(page), { timeout: 15_000 })
    .toMatch(new RegExp(`^@moku ${key} · [^]*\nshot: `));
  await expect(toast(page)).toHaveText("Reference, shot and bookmark copied");
  return clipboard(page);
}

/**
 * Width and height of a PNG of the game root, after its signature.
 *
 * @param file - The path relative to the root.
 * @returns The size.
 */
async function pngSize(file: string): Promise<{ w: number; h: number }> {
  const bytes = await readFile(path.join(GAME_ROOT, file));
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

/**
 * One socket message as JSON, undefined when it is not JSON.
 *
 * @param payload - The frame payload.
 * @returns The message.
 */
function parse(payload: string | Buffer): Message | undefined {
  try {
    return JSON.parse(String(payload)) as Message;
  } catch {
    return undefined;
  }
}

/**
 * A reference block without its clock (the HH:MM:SS of its game line).
 *
 * @param text - The block.
 * @returns The block without the time.
 */
function withoutClock(text: string): string {
  return text.replace(/ · \d\d:\d\d:\d\d · /, " · ");
}

/**
 * Records the bookmarks the tools page takes: every `game.bookmark` run it sends and the answer
 * its socket receives for it.
 *
 * @param page - The test page, before the tools page opens.
 * @returns The bookmarks, in order.
 */
function recordBookmarks(page: Page): Taken[] {
  const taken: Taken[] = [];
  page.on("websocket", socket => {
    const asked = new Set<number>();
    socket.on("framesent", ({ payload }) => {
      const message = parse(payload);
      const isBookmark = message?.method === "run" && message.params?.id === "game.bookmark";
      if (isBookmark && message?.id !== undefined) asked.add(message.id);
    });
    socket.on("framereceived", ({ payload }) => {
      const message = parse(payload);
      if (message?.id === undefined || !asked.has(message.id)) return;
      asked.delete(message.id);
      const frame = message.result?.state?.frame;
      if (typeof frame === "number") taken.push({ frame, value: message.result?.value });
    });
  });
  return taken;
}

test.beforeEach(async () => {
  await rm(path.join(GAME_ROOT, CAPTURES_DIR), { recursive: true, force: true });
});

test.afterEach(async () => {
  await rm(path.join(GAME_ROOT, CAPTURES_DIR), { recursive: true, force: true });
});

test.describe("pick · for the chat", () => {
  test("a pick on settingsBoard copies the eleven-line block, saves both PNGs, and its bookmark restores board/settings/open", async ({
    page,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const taken = recordBookmarks(page);
    await openTools(page);
    await page.locator("[data-ui=rail] button[data-workspace=game]").click();
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-docked", "stage");
    await expect.poll(() => gamePath(page)).toBe("home");
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
    await answer(page, "openSettings");
    await expect.poll(() => gamePath(page)).toBe("board/settings/open");
    const board = await settledRect(page, "settingsBoard");

    await pickIn(page, await toClient(page, board), /^settingsBoard · panel · \d+×\d+$/);
    await expect(toast(page)).toHaveText("Reference, shot and bookmark copied", {
      timeout: 15_000
    });
    const block = await clipboard(page);
    const lines = block.split("\n");

    // Every line, in the fixed order.
    expect(
      lines.map(text => (text.startsWith("@moku ") ? "@moku" : text.split(":")[0])),
      block
    ).toEqual([...BLOCK_ORDER]);
    const [head, pathLine, source, layout, bounds, state, flow, gameLine, device, restore, shot] =
      lines;
    const frame = Number(/ · f(\d+)$/.exec(head ?? "")?.[1]);
    expect(head, block).toMatch(/^@moku settingsBoard · panel · settingsPopup\/open · f\d+$/);
    expect(pathLine).toBe("path: settingsScreen/settingsBoard");
    expect(source).toMatch(
      /^source: features\/settings\/settings\.tsx:301 · texture: ui\.panel-signboard$/
    );
    expect(layout).toMatch(/^layout: settingsScreen \(column, padding \d+\/\d+\/\d+\/\d+\)/);
    const px = [board.x, board.y, board.w, board.h].map(value => Math.round(value));
    expect(bounds).toMatch(
      new RegExp(String.raw`^bounds: ${px[0]},${px[1]} ${px[2]}×${px[3]} px · ref \d+,\d+ \d+×\d+$`)
    );
    expect(state).toBe("state: visible");
    expect(flow).toMatch(/^flow: board > settings > open · last: board\/settings\/enter → done/);
    expect(gameLine).toMatch(
      new RegExp(
        String.raw`^game: merge-game 0\.0\.0 · s-[0-9a-f]{4} · f${frame} · \d\d:\d\d:\d\d · live · (clean|tainted)$`
      )
    );
    expect(device).toBe("device: iPhone 15 393×852 portrait · dpr 3 · safe 59/0/34/0");
    expect(restore).toMatch(/^restore: bookmark settingsBoard-f\d+$/);
    const shotMatch = /^shot: (\S+) · frame: (\S+)$/.exec(shot ?? "");
    expect(shotMatch, shot).not.toBeNull();
    const [, crop = "", full = ""] = shotMatch ?? [];
    expect(crop).toBe(`${CAPTURES_DIR}/settingsBoard-f${frame}.png`);
    expect(full).toBe(`${CAPTURES_DIR}/f${frame}.png`);

    // Both PNGs exist in the game copy: the full frame at the device aspect, the crop is the
    // element plus 8 px around it, scaled by the shot's pixel ratio.
    expect(existsSync(path.join(GAME_ROOT, crop))).toBe(true);
    expect(existsSync(path.join(GAME_ROOT, full))).toBe(true);
    const fullSize = await pngSize(full);
    expect(fullSize.w / fullSize.h).toBeCloseTo(393 / 852, 2);
    const ratio = fullSize.w / 393;
    const cropSize = await pngSize(crop);
    const left = Math.max(0, board.x - 8);
    const right = Math.min(393, board.x + board.w + 8);
    expect(Math.abs(cropSize.w - (right - left) * ratio)).toBeLessThanOrEqual(2);
    expect(cropSize.w).toBeLessThan(fullSize.w);

    // The Element tab shows the same block, read-only.
    await expandSide(page);
    const tab = page.locator("[data-workspace-host=game] [data-game=side] [data-part=element]");
    const pre = tab.locator("pre[data-part=reference]");
    await expect(pre).toHaveAttribute("aria-busy", "false");
    const shown = (await pre.textContent()) ?? "";
    expect(withoutClock(shown)).toBe(withoutClock(block));

    // The bookmark of the pick: its id names the frame of the game.bookmark answer.
    const id = /^restore: bookmark (settingsBoard-f(\d+))$/.exec(restore ?? "");
    const bookmark = taken.find(entry => entry.frame === Number(id?.[2]));
    expect(bookmark, `a game.bookmark answer for ${id?.[1]}`).toBeDefined();

    // A fresh start (the toolbar Reload, no restore) goes back to home; the bookmark brings the
    // game back to the settings popup over the board.
    await bar(page, "reload").click();
    await expect.poll(() => gamePath(page), { timeout: 30_000 }).toBe("home");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: 30_000
    });
    await runCommand(page, "game.restore", { bookmark: bookmark?.value });
    await expect.poll(() => gamePath(page)).toBe("board/settings/open");
    const back = await settledRect(page, "settingsBoard");
    expect([back.x, back.y, back.w, back.h].map(value => Math.round(value))).toEqual(px);
  });

  test("Reference mode: proxies carry the frame, the reference bounds and the style source; card0 resolves as a loop key", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    // R turns Reference mode on in every top-bar layout.
    await page.keyboard.press("r");
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");

    // A proxy carries its frame and its reference bounds before any pick.
    const play = page.locator('[data-moku-proxy][data-moku-key="play"]');
    await expect(play).toHaveAttribute("data-moku-frame", /^\d+$/);
    await expect(play).toHaveAttribute("data-moku-ref-bounds", /^\d+ \d+ \d+ \d+$/);

    // A pick through the proxy (its click is a pointerup) finds the source: the style source joins.
    const block = await pickProxy(page, "play");
    const style = /· style: playButton (features\/home\/styles\.ts:\d+)/.exec(block);
    expect(style, block).not.toBeNull();
    await expect(play).toHaveAttribute("data-moku-style-source", style?.[1] ?? "");
    await expect(play).toHaveAttribute("data-moku-source", /^features\/home\/view\.tsx:\d+$/);
    const ref = /· ref (\d+),(\d+) (\d+)×(\d+)$/m.exec(block);
    await expect(play).toHaveAttribute("data-moku-ref-bounds", (ref?.slice(1) ?? []).join(" "));

    // On the board, the order card keyed card0 is built in a loop: `card${slot}`.
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
    const card0 = page.locator('[data-moku-proxy][data-moku-key="card0"]');
    await expect(card0).toHaveCount(1, { timeout: 15_000 });
    const cardBlock = await pickProxy(page, "card0");
    expect(cardBlock.split("\n")[0]).toMatch(/^@moku card0 · /);
    expect(cardBlock).toMatch(/^source: features\/orders\/strip\.tsx:157 \(loop\)/m);
    await page.keyboard.press("r");
    await expect(page.locator("[data-moku-proxy]")).toHaveCount(0);
  });

  test("Shot and Series put their paths on the clipboard", async ({ tools }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "capture").click();
    const card = page.locator("[data-game=card]");
    await expect(card.locator("[data-part=saved]")).toHaveText("✓ Screenshot saved");
    const shown = ((await card.locator("[data-part=path]").textContent()) ?? "").trim();
    await expect.poll(() => clipboard(page)).toBe(`shot: ${shown}`);
    await card.getByRole("button", { name: "Close" }).click();

    await bar(page, "series").click();
    const pop = page.locator("[data-game=series]");
    await pop
      .getByRole("radiogroup", { name: "Duration" })
      .getByRole("radio", { name: "1 s" })
      .click();
    await pop
      .getByRole("radiogroup", { name: "Interval" })
      .getByRole("radio", { name: "250 ms" })
      .click();
    await pop.getByRole("button", { name: "● Start" }).click();
    const sheet = page.locator("dialog[data-game=sheet]");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => clipboard(page))
      .toMatch(/^series: \.moku\/captures\/series-\d{4}-\d{2}-\d{2}-\d{4}\/ \(4 frames\)$/);
    await sheet.getByRole("button", { name: "Close" }).click();
  });
});
