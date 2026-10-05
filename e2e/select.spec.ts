/**
 * @file Select over the hub (U4, U7, D-33) on the frozen merge-game. A headless tools client, as
 * the MCP bridge is one (a raw websocket with `kind=tools` and no role), sends the editor-channel
 * request `select { key }`. The hub relays it to the editor page, the tools page whose link
 * connects with `role=page`. The page shows the element in the Game workspace with the selected
 * box on it, picks it like a click but without the clipboard (bookmark, the crop
 * `<key>-f<frame>-crop.jpg`, the card `<key>-f<frame>.md`) and answers the selection.
 * `editor.selection` then answers the same element, and the hub sent it to every tools client as
 * the `selection` notification. An unknown key answers -32602.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { jpegSize } from "./pictures";

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The captures folder of gameView, relative to the game root. */
const CAPTURES_DIR = ".moku/captures";

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** The fields of a SelectionInfo this spec reads. */
type Selection = {
  readonly key?: string;
  readonly name: string;
  readonly type: string;
  readonly rect?: Rect;
  readonly card?: string;
  readonly crop?: string;
  readonly line?: string;
};

/** One JSON-RPC message from the hub. */
type Message = {
  readonly id?: number;
  readonly channel?: string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
};

/** A headless tools client of the hub. */
type ToolsClient = {
  /** Sends an editor-channel request and resolves its answer. */
  call(method: string, params: object): Promise<Message>;
  /** The params of every editor-channel notification of a method received so far. */
  notes(method: string): unknown[];
  /** Closes the socket. */
  close(): void;
};

/** The boot JSON of the tools page: the socket URL and the per-start token. */
type Boot = { readonly ws: string; readonly token: string };

/**
 * Connects a plain tools client to the hub the tools page uses: the socket URL and the token of
 * the page's boot JSON, the page origin as the Origin header (the hub's upgrade guard wants one),
 * `kind=tools` and no role.
 *
 * @param page - The tools page.
 * @returns The client, once its socket is open.
 */
async function connectTools(page: Page): Promise<ToolsClient> {
  const boot = JSON.parse((await page.locator("#moku-editor-boot").textContent()) ?? "{}") as Boot;
  const url = `${boot.ws}?token=${encodeURIComponent(boot.token)}&kind=tools`;
  const origin = new URL(page.url()).origin;
  // Node's WebSocket takes headers; the DOM typing of the constructor does not know them.
  const socket = Reflect.construct(WebSocket, [url, { headers: { origin } }]) as WebSocket;

  const received: Message[] = [];
  const answers = new Map<number, (message: Message) => void>();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data)) as Message;
    const answer = message.id === undefined ? undefined : answers.get(message.id);
    if (message.method === undefined && answer !== undefined) answer(message);
    else received.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("the tools socket did not open")), {
      once: true
    });
  });

  let nextId = 1;
  return {
    call: (method, params) =>
      new Promise(resolve => {
        const id = nextId;
        nextId += 1;
        answers.set(id, resolve);
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, channel: "editor", method, params }));
      }),
    notes: method =>
      received
        .filter(message => message.channel === "editor" && message.method === method)
        .map(message => message.params),
    close: () => socket.close(1000)
  };
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
 * The rect of a keyed element in game CSS px, from `game.locate` of the game page's registry.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The rect.
 */
async function locate(page: Page, key: string): Promise<Rect> {
  const json = await gameFrame(page).evaluate(async value => {
    const registry = (
      Reflect.get(globalThis, "editor") as {
        registry: { source(id: string): { read(input: object): Promise<unknown> } };
      }
    ).registry;
    return JSON.stringify(await registry.source("game.locate").read({ key: value }));
  }, key);
  return JSON.parse(json) as Rect;
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
 * The text on the clipboard.
 *
 * @param page - The test page.
 * @returns The text.
 */
async function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async () => {
  await rm(path.join(GAME_ROOT, CAPTURES_DIR), { recursive: true, force: true });
});

test.afterEach(async () => {
  await rm(path.join(GAME_ROOT, CAPTURES_DIR), { recursive: true, force: true });
});

test.describe("select over the hub", () => {
  test("a tools client selects play by key: the editor shows it in Game with the selected box, writes its card and crop without the clipboard, and editor.selection answers it", async ({
    tools,
    errors
  }) => {
    // The unknown key at the end fails in the page's select handler, which link logs at warn.
    errors.allow(/event: link:request-failed,/);
    const page = tools.page;
    await tools.show("state");
    await page.evaluate(() => navigator.clipboard.writeText("untouched"));
    const client = await connectTools(page);
    try {
      const answer = await client.call("select", { key: "play" });
      expect(answer.error, JSON.stringify(answer.error)).toBeUndefined();
      const info = answer.result as Selection;
      expect(info).toMatchObject({ key: "play", name: "play", type: "button" });

      // The editor page shows it: the Game workspace, the selected box on the element.
      await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "game");
      const selected = page.locator('[data-game=overlay] [data-box="selected"]');
      await expect(selected).toBeVisible();
      const expected = await toClient(page, await locate(page, "play"));
      await expect
        .poll(async () => {
          const box = await selected.boundingBox();
          if (box === null) return Number.POSITIVE_INFINITY;
          return Math.max(
            Math.abs(box.x - expected.x),
            Math.abs(box.y - expected.y),
            Math.abs(box.width - expected.w),
            Math.abs(box.height - expected.h)
          );
        })
        .toBeLessThan(2);

      // The pick without the clipboard: the card and the JPEG crop exist; the line names the card.
      expect(info.card).toMatch(/^\.moku\/captures\/play-f\d+\.md$/);
      expect(info.crop).toMatch(/^\.moku\/captures\/play-f\d+-crop\.jpg$/);
      expect(info.line).toMatch(/^@moku play button · .* · \.moku\/captures\/play-f\d+\.md$/);
      expect(existsSync(path.join(GAME_ROOT, info.card ?? ""))).toBe(true);
      const crop = await jpegSize(path.join(GAME_ROOT, info.crop ?? ""));
      expect(crop.w).toBeGreaterThan(0);
      expect(await clipboard(page)).toBe("untouched");

      // editor.selection answers the same element; the hub sent it to this client too.
      const kept = await client.call("selection", {});
      expect(kept.error).toBeUndefined();
      expect(kept.result).toMatchObject({
        key: "play",
        card: info.card,
        crop: info.crop,
        line: info.line
      });
      await expect
        .poll(() =>
          client
            .notes("selection")
            .some(params => (params as Selection | undefined)?.card === info.card)
        )
        .toBe(true);

      // An unknown key answers -32602 and keeps the selection.
      const missing = await client.call("select", { key: "nope" });
      expect(missing.error?.code).toBe(-32_602);
      expect(missing.error?.message).toContain("No element with key nope");
      await expect(selected).toBeVisible();
    } finally {
      client.close();
    }
  });
});
