/**
 * @file A pick for the chat (round 2 R2, round 2b R13) on the frozen merge-game: a picker click on
 * the settings board (opened from the board's HUD) bookmarks the game, saves the cropped element
 * (`<key>-f<frame>-crop.jpg`) and the full frame (`f<frame>-full.jpg`, JPEG by default, D-34)
 * in today's folder `.moku/captures/<yyyy-mm-dd>/` of the game copy (captures by day), writes the
 * card `<key>-f<frame>.md` there (the reference block with its eleven lines in the fixed order
 * inside a `text` fence, the JSX of the element and the links to both pictures), puts ONE line
 * naming the card on the clipboard and toasts "Reference, shot and bookmark copied". The Element
 * tab shows the full block and the Code section; the capture card of the pick offers the line again. Restoring the pick's bookmark
 * from a fresh start brings the game back to board/settings/open. In Reference mode the proxies
 * carry the frame, the reference bounds and, once a pick found it, the style source; a key built
 * in a loop (card0) resolves to its template literal. In Reference mode the cursor over the game is
 * a crosshair, a real click still picks one element, and a drag picks an area (U9): the card
 * `area-f<frame>.md` lists the elements inside it with their child trees, layout lines and px
 * bounds (captures-by-day U5), next to the area's crop. In Select mode a drag picks an area too
 * (U4). Shot and Series put their paths on the clipboard too.
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
import { jpegSize } from "./pictures";

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

/**
 * The one clipboard line of a pick: `@moku <name> <type> · <flow/node> · <file:line> · ref x,y w×h
 * · <card path>`; the place and the ref bounds are left out when unknown. Group 1 is the name,
 * group 2 the card path.
 */
const REFERENCE_LINE = /^@moku (\S+) \S+ · .* · (\.moku\/captures\/\S+-f\d+(?:-\d+)?\.md)$/;

/** The reference block inside a card file: its `text` fence. */
const TEXT_FENCE = /^```text\n([\s\S]*?)\n```$/m;

/**
 * The one clipboard line of an area (U9): `@moku area <w>×<h> · <flow/node> · <N> elements · ref
 * x,y w×h · <card path>`. Group 1 and 2 are the area's size in device px, group 3 the element
 * count, group 4 the card path.
 */
const AREA_LINE =
  /^@moku area (\d+)×(\d+) · .* · (\d+) elements? · .*(\.moku\/captures\/\d{4}-\d{2}-\d{2}\/area-f\d+(?:-\d+)?\.md)$/;

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
 * The day folder of a capture path (captures by day).
 *
 * @param capture - A capture path, relative to the game root.
 * @returns `.moku/captures/<yyyy-mm-dd>`.
 */
function dayOf(capture: string): string {
  const day = /^\.moku\/captures\/\d{4}-\d{2}-\d{2}(?=\/)/.exec(capture)?.[0] ?? "";
  expect(day, capture).not.toBe("");
  return day;
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

/** What a pick shared: the clipboard line, the card it names, the card text and its block. */
type Shared = {
  readonly line: string;
  readonly card: string;
  readonly text: string;
  readonly block: string;
};

/**
 * Reads the card a reference line names, from the game copy, and the block in its `text` fence.
 *
 * @param line - The clipboard line.
 * @returns The line, the card path, the card text and the block.
 */
async function sharedOf(line: string): Promise<Shared> {
  const card = REFERENCE_LINE.exec(line)?.[2] ?? "";
  expect(card, line).not.toBe("");
  const text = await readFile(path.join(GAME_ROOT, card), "utf8");
  const [, block = ""] = TEXT_FENCE.exec(text) ?? [];
  expect(block, text).not.toBe("");
  return { line, card, text, block };
}

/**
 * Picks an element through its Reference mode proxy (a click on a proxy is its pointerup), waits
 * for its one line on the clipboard (emptied first) and reads the card it names.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns What the pick shared.
 */
async function pickProxy(page: Page, key: string): Promise<Shared> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.locator(`[data-moku-proxy][data-moku-key="${key}"]`).dispatchEvent("pointerup");
  await expect.poll(() => clipboard(page), { timeout: 15_000 }).toMatch(REFERENCE_LINE);
  await expect(toast(page)).toHaveText("Reference, shot and bookmark copied");
  const line = await clipboard(page);
  expect(REFERENCE_LINE.exec(line)?.[1], line).toBe(key);
  return sharedOf(line);
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
  test("a pick on settingsBoard copies one line naming its card, the card holds the eleven-line block, both JPEGs exist, and its bookmark restores board/settings/open", async ({
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
    // The clipboard holds one line: name, type, flow node, source, ref bounds and the card.
    const line = await clipboard(page);
    expect(line).not.toContain("\n");
    expect(line).toMatch(
      /^@moku settingsBoard panel · settingsPopup\/open · features\/settings\/settings\.tsx:301 · ref \d+,\d+ \d+×\d+ · \.moku\/captures\/\d{4}-\d{2}-\d{2}\/settingsBoard-f\d+\.md$/
    );
    const { card, text, block } = await sharedOf(line);
    const lines = block.split("\n");

    // The card's block: every line, in the fixed order.
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
    // Everything of the pick goes into today's day folder (captures by day).
    const day = dayOf(card);
    expect(crop).toBe(`${day}/settingsBoard-f${frame}-crop.jpg`);
    expect(full).toBe(`${day}/f${frame}-full.jpg`);
    // The card is named for the same frame; the line's ref bounds are the block's.
    expect(card).toBe(`${day}/settingsBoard-f${frame}.md`);
    const ref = /· ref (\d+,\d+ \d+×\d+)$/.exec(bounds ?? "")?.[1];
    expect(line).toContain(` · ref ${ref} · `);
    // The card: its title, the block, the JSX of the board with file:line, and both images.
    expect(text.split("\n")[0]).toBe("# @moku settingsBoard panel");
    expect(text).toMatch(/^## JSX · features\/settings\/settings\.tsx:300$/m);
    expect(text).toMatch(/^```tsx\n\s*<Signboard\n\s*id="settingsBoard"/m);
    expect(text).toContain(`![element](settingsBoard-f${frame}-crop.jpg)`);
    expect(text).toContain(`![frame](f${frame}-full.jpg)`);

    // Both JPEGs exist in the game copy: the full frame at the device aspect, the crop is the
    // element plus 8 px around it, scaled by the shot's pixel ratio.
    expect(existsSync(path.join(GAME_ROOT, crop))).toBe(true);
    expect(existsSync(path.join(GAME_ROOT, full))).toBe(true);
    const fullSize = await jpegSize(path.join(GAME_ROOT, full));
    expect(fullSize.w / fullSize.h).toBeCloseTo(393 / 852, 2);
    const ratio = fullSize.w / 393;
    const cropSize = await jpegSize(path.join(GAME_ROOT, crop));
    const left = Math.max(0, board.x - 8);
    const right = Math.min(393, board.x + board.w + 8);
    expect(Math.abs(cropSize.w - (right - left) * ratio)).toBeLessThanOrEqual(2);
    expect(cropSize.w).toBeLessThan(fullSize.w);

    // The Element tab shows the card's block, read-only.
    await expandSide(page);
    const tab = page.locator("[data-workspace-host=game] [data-game=side] [data-part=element]");
    const pre = tab.locator("pre[data-part=reference]");
    await expect(pre).toHaveAttribute("aria-busy", "false");
    const shown = (await pre.textContent()) ?? "";
    expect(withoutClock(shown)).toBe(withoutClock(block));

    // The Code section (round 2b R12): the board's JSX from <Signboard to </Signboard>, 20 lines
    // and then Show all. The board takes no style={…} of its own, so no style block shows.
    const code = tab.locator("section[data-part=code]");
    const jsx = code.locator("[data-part=snippet]").first();
    await expect(jsx.locator("header [data-part=title]")).toHaveText("JSX", { timeout: 20_000 });
    await expect(jsx.locator("header [data-part=where]")).toHaveText(
      "features/settings/settings.tsx:300"
    );
    const rows = jsx.locator("[data-part=code-lines] > div");
    await expect(rows).toHaveCount(20);
    await expect(rows.first()).toHaveAttribute("data-line", "300");
    await expect(rows.nth(1)).toContainText('id="settingsBoard"');
    const showAll = jsx.locator("[data-action=show-all]");
    await expect(showAll).toHaveText("Show all 22 lines");
    await showAll.click();
    await expect(rows).toHaveCount(22);
    await expect(rows.last()).toContainText("</Signboard>");
    await expect(showAll).toHaveCount(0);
    await expect(code.locator("[data-part=snippet]")).toHaveCount(1);

    // The capture card of the pick offers the line again: its Reference action.
    const shotCard = page.locator("[data-game=card]");
    await expect(shotCard.locator("[data-part=path]")).toHaveAttribute("title", crop);
    const again = shotCard.getByRole("button", { name: "Reference" });
    await expect(again).toHaveAttribute("title", line);
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await again.click();
    await expect.poll(() => clipboard(page)).toBe(line);
    await expect(toast(page)).toHaveText("✓ Reference copied");

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
    const { block, text } = await pickProxy(page, "play");
    const style = /· style: playButton (features\/home\/styles\.ts:\d+)/.exec(block);
    expect(style, block).not.toBeNull();
    await expect(play).toHaveAttribute("data-moku-style-source", style?.[1] ?? "");
    await expect(play).toHaveAttribute("data-moku-source", /^features\/home\/view\.tsx:\d+$/);
    const ref = /· ref (\d+),(\d+) (\d+)×(\d+)$/m.exec(block);
    await expect(play).toHaveAttribute("data-moku-ref-bounds", (ref?.slice(1) ?? []).join(" "));
    // The card holds the JSX and the style block, each fenced with its file:line.
    expect(text).toMatch(/^## JSX · features\/home\/view\.tsx:\d+$/m);
    expect(text).toContain(`## Style · playButton · ${style?.[1] ?? ""}`);
    expect(text).toContain("export const playButton = defineStyle({");

    // On the board, the order card keyed card0 is built in a loop: `card${slot}`.
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
    const card0 = page.locator('[data-moku-proxy][data-moku-key="card0"]');
    await expect(card0).toHaveCount(1, { timeout: 15_000 });
    const card0Shared = await pickProxy(page, "card0");
    expect(card0Shared.line).toMatch(/ · features\/orders\/strip\.tsx:157 \(loop\) · /);
    expect(card0Shared.block.split("\n")[0]).toMatch(/^@moku card0 · /);
    expect(card0Shared.block).toMatch(/^source: features\/orders\/strip\.tsx:157 \(loop\)/m);
    // A loop key shows the element of its template line.
    expect(card0Shared.text).toMatch(/^## JSX · features\/orders\/strip\.tsx:\d+$/m);
    expect(card0Shared.text).toContain("`card${");
    await page.keyboard.press("r");
    await expect(page.locator("[data-moku-proxy]")).toHaveCount(0);
  });

  test("Reference mode: the cursor is a crosshair, a click picks the element under it, a drag picks the area: area-f<frame>.md lists the elements inside next to its crop", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    await page.keyboard.press("r");
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");

    // A crosshair over the whole proxy layer and over every proxy.
    const layer = page.locator("[data-moku-proxies]");
    const play = page.locator('[data-moku-proxy][data-moku-key="play"]');
    await expect(play).toHaveCount(1);
    expect(await layer.evaluate(element => getComputedStyle(element).cursor)).toBe("crosshair");
    expect(await play.evaluate(element => getComputedStyle(element).cursor)).toBe("crosshair");

    // A real click (press and release on one spot) picks the one element under the pointer.
    const rect = await toClient(page, await settledRect(page, "play"));
    const at = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const under = await page.evaluate(point => {
      const element = document.elementFromPoint(point.x, point.y);
      return element instanceof HTMLElement ? (element.dataset.mokuName ?? "") : "";
    }, at);
    expect(under, "a proxy under the centre of the Play sign").toMatch(/^play/);
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => clipboard(page), { timeout: 15_000 }).toMatch(REFERENCE_LINE);
    expect(REFERENCE_LINE.exec(await clipboard(page))?.[1]).toBe(under);
    await expect(toast(page)).toHaveText("Reference, shot and bookmark copied");

    // A drag from just outside one corner of the Play sign past the other: the dashed marquee
    // follows the pointer, the release picks the area.
    await page.evaluate(() => navigator.clipboard.writeText(""));
    const margin = 6;
    await page.mouse.move(rect.x - margin, rect.y - margin);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.w + margin, rect.y + rect.h + margin, { steps: 8 });
    const marquee = page.locator('[data-game=overlay] [data-box="area"]');
    await expect(marquee).toBeVisible();
    await expect(marquee).toHaveCSS("border-top-style", "dashed");
    await page.mouse.up();
    await expect(marquee).toHaveCount(0);
    await expect.poll(() => clipboard(page), { timeout: 15_000 }).toMatch(AREA_LINE);
    await expect(toast(page)).toHaveText("Reference, shot and bookmark copied");
    const line = await clipboard(page);
    const [, areaW = "0", areaH = "0", count = "0", card = ""] = AREA_LINE.exec(line) ?? [];
    expect(Number(count), line).toBeGreaterThanOrEqual(1);

    // The card: its title, the block whose head is the line, one line per element inside, the
    // tail lines and both pictures. Group roots only: the Play sign stack is an item, the Play
    // button and its label inside it are child lines under it; the meadow behind is not inside.
    const text = await readFile(path.join(GAME_ROOT, card), "utf8");
    expect(text.split("\n")[0]).toBe(`# @moku area ${areaW}×${areaH}`);
    const [, block = ""] = TEXT_FENCE.exec(text) ?? [];
    const lines = block.split("\n");
    expect(lines[0]).toBe(line);
    const items = lines.filter(entry => entry.startsWith("- "));
    expect(items, block).toHaveLength(Number(count));
    const signs = items.filter(entry => entry.startsWith("- playSign stack · key playSign · "));
    expect(signs, block).toHaveLength(1);
    expect(
      items.filter(entry => / · key play(Label)? · /.test(entry)),
      block
    ).toEqual([]);
    expect(block).not.toContain("· key homeBackground ·");

    // The fuller card (U5): the sign's line ends with its px bounds and its reference rect, a
    // child line under it is indented with its px bounds, and a layout line names the chain.
    const sign = await settledRect(page, "playSign");
    const px = [sign.x, sign.y, sign.w, sign.h].map(value => Math.round(value));
    expect(signs[0]).toMatch(
      new RegExp(String.raw` · ${px[0]},${px[1]} ${px[2]}×${px[3]} px · ref \d+,\d+ \d+×\d+$`)
    );
    const child = lines.find(entry => entry.startsWith("  - play "));
    expect(child, block).toContain(" · key play · ");
    expect(child, block).toMatch(/ \d+,\d+ \d+×\d+ px$/);
    expect(block).toMatch(/^layout: playSign < \S+/m);
    const frame = /\/area-f(\d+)/.exec(card)?.[1] ?? "";
    const day = dayOf(card);
    expect(block).toMatch(/^restore: bookmark area-f\d+(-\d+)?$/m);
    const shot = /^shot: (\S+) · frame: (\S+)$/m.exec(block);
    expect(shot, block).not.toBeNull();
    const [, crop = "", full = ""] = shot ?? [];
    expect(crop).toBe(`${day}/area-f${frame}-crop.jpg`);
    expect(full).toBe(`${day}/f${frame}-full.jpg`);
    expect(text).toContain(`![area](area-f${frame}-crop.jpg)`);
    expect(text).toContain(`![frame](f${frame}-full.jpg)`);

    // The crop is the area plus 8 px around it, at the shot's pixel ratio.
    const fullSize = await jpegSize(path.join(GAME_ROOT, full));
    const ratio = fullSize.w / 393;
    const cropSize = await jpegSize(path.join(GAME_ROOT, crop));
    expect(Math.abs(cropSize.w - (Number(areaW) + 16) * ratio)).toBeLessThanOrEqual(2 * ratio + 2);
    expect(Math.abs(cropSize.h - (Number(areaH) + 16) * ratio)).toBeLessThanOrEqual(2 * ratio + 2);
  });

  test("Select mode: a drag picks the area like Reference mode: area-f<frame>.md in today's folder, the area line on the clipboard, the picker off (U4)", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    const rect = await toClient(page, await settledRect(page, "play"));
    await page.evaluate(() => navigator.clipboard.writeText(""));

    // Select on: the picker layer takes the pointer over the game.
    await bar(page, "pick").click();
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-game=overlay] [data-part=picker]")).toBeVisible();

    // A drag from just outside one corner of the Play sign past the other: the marquee follows,
    // the release picks the area and turns the picker off.
    const margin = 6;
    await page.mouse.move(rect.x - margin, rect.y - margin);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.w + margin, rect.y + rect.h + margin, { steps: 8 });
    const marquee = page.locator('[data-game=overlay] [data-box="area"]');
    await expect(marquee).toBeVisible();
    await page.mouse.up();
    await expect(marquee).toHaveCount(0);
    await expect.poll(() => clipboard(page), { timeout: 15_000 }).toMatch(AREA_LINE);
    await expect(toast(page)).toHaveText("Reference, shot and bookmark copied");
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");

    // The card is written in today's folder and lists the Play sign.
    const line = await clipboard(page);
    const match = AREA_LINE.exec(line);
    const count = match?.[3] ?? "0";
    const card = match?.[4] ?? "";
    expect(Number(count), line).toBeGreaterThanOrEqual(1);
    expect(card).toMatch(/^\.moku\/captures\/\d{4}-\d{2}-\d{2}\/area-f\d+\.md$/);
    const text = await readFile(path.join(GAME_ROOT, card), "utf8");
    const [, block = ""] = TEXT_FENCE.exec(text) ?? [];
    expect(block.split("\n")[0]).toBe(line);
    expect(block).toMatch(/^- playSign stack · key playSign · /m);
  });

  test("Shot and Series put their paths on the clipboard", async ({ tools }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "capture").click();
    const card = page.locator("[data-game=card]");
    await expect(card.locator("[data-part=saved]")).toHaveText("✓ Screenshot saved");
    // The card cuts the path in the middle; its title holds the whole path (round 2b R14).
    const shown = (await card.locator("[data-part=path]").getAttribute("title")) ?? "";
    expect(shown).toMatch(/^\.moku\/captures\/\d{4}-\d{2}-\d{2}\/\d{4}-[\w-]+\.jpg$/);
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
      .toMatch(/^series: \.moku\/captures\/\d{4}-\d{2}-\d{2}\/series-\d{4}\/ \(4 frames\)$/);
    await sheet.getByRole("button", { name: "Close" }).click();
  });
});
