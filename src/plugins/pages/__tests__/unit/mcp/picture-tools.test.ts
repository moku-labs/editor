/* eslint-disable unicorn/no-null -- null is the value an inert renderer answers */
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, describe, expect, it } from "vitest";
import type { Json } from "../../../../registry/protocol";
import { wireError } from "../../../../registry/protocol";
import { referenceTool, screenshotTool, seriesTool } from "../../../mcp/picture-tools";
import { MAX_IMAGE_CHARS } from "../../../mcp/results";
import { session } from "../../fake-hub";
import type { ToolSetup } from "../../mcp-tools";
import { jpegOf, jsonOf, png, pngOf, textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp picture tools (M5, M7): the liveness check, editor.capture with
// maxWidth and the 300 KB retry, game.capture { sheet } on game ≥ 0.4, and the
// reference cards of .moku/captures with their crop.
// ─────────────────────────────────────────────────────────────────────────────

let setup: ToolSetup | undefined;

afterEach(async () => {
  await setup?.cleanup();
  setup = undefined;
});

/** The setup of a test, kept for the cleanup. */
async function ready(options: Parameters<typeof toolSetup>[0] = {}): Promise<ToolSetup> {
  setup = await toolSetup(options);
  return setup;
}

/** A run result around a value. */
function ran(value: Json, frame = 1840): Json {
  return { value, state: { path: "board", frame, tainted: false } };
}

/** The device of the shots. */
const DEVICE = { w: 393, h: 852, orientation: "portrait" };

/** A live session (running, visible). */
const LIVE = session("s-1", { heartbeat: { frame: 1840, paused: false, silent: false } });

/** The editor.sheet command of a capture plugin that has it. */
const SHEET_COMMAND = {
  id: "editor.sheet",
  title: "Contact sheet",
  input: {
    frames: "number",
    everyMs: "number",
    maxWidth: "number?",
    format: "string?",
    quality: "number?"
  },
  effect: "read"
};

/** A manifest whose game.capture has the given input, with the given editor commands. */
function manifest(input: Json, editor: Json[] = []): Json {
  return {
    game: "g",
    page: "p",
    embedded: true,
    sources: [],
    commands: [{ id: "game.capture", title: "Capture", input, effect: "read" }, ...editor]
  };
}

/**
 * Writes the cards on disk (for their times) and answers them from the fake hub.
 *
 * @param current - The setup.
 * @param cards - Name, text and modification time (s) of each card.
 */
async function serveCards(
  current: ToolSetup,
  cards: { name: string; text: string; at: number }[]
): Promise<void> {
  const dir = join(current.root, ".moku", "captures");
  await mkdir(dir, { recursive: true });
  for (const card of cards) {
    await writeFile(join(dir, card.name), card.text);
    await utimes(join(dir, card.name), card.at, card.at);
  }
  current.hub.handle("files.list", () => [
    { path: ".moku/captures/f25.png", kind: "file", size: 9 },
    ...cards.map(card => ({ path: `.moku/captures/${card.name}`, kind: "file", size: 1 }))
  ]);
  current.hub.handle("files.read", params => {
    const path =
      typeof params === "object" && params !== null && "path" in params ? params.path : "";
    const card = cards.find(entry => `.moku/captures/${entry.name}` === path);
    return { text: card?.text ?? "", version: "v1" };
  });
  current.hub.handle("files.readBinary", () => ({ dataUrl: png(12), version: "v2" }));
}

describe("liveness (M7)", () => {
  it.each([
    ["paused", { frame: 1840, paused: true, silent: false }],
    ["hidden", { frame: 1840, paused: false, silent: true }]
  ])("answers a %s game with a message, without a capture", async (_kind, heartbeat) => {
    const { run, hub } = await ready({ sessions: [session("s-1", { heartbeat })] });
    for (const tool of [screenshotTool, seriesTool]) {
      const { result } = await run(tool);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "game paused or hidden at frame 1840 — bring the editor pane to front or resume"
          }
        ],
        isError: true
      });
    }
    expect(hub.requests).toEqual([]);
  });
});

describe("moku_screenshot", () => {
  it("runs editor.capture with maxWidth 1080 as JPEG and answers the facts and the image", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.run", () => ran({ image: png(8), frame: 1841, device: DEVICE }));
    const { result } = await run(screenshotTool);
    expect(hub.requests[0]).toMatchObject({
      method: "run",
      params: { id: "editor.capture", input: { maxWidth: 1080, format: "jpeg" } }
    });
    expect(jsonOf(result)).toEqual({ frame: 1841, device: DEVICE, maxWidth: 1080, kb: 0 });
    expect(result.content[1]).toEqual({
      type: "image",
      data: "A".repeat(8),
      mimeType: "image/png"
    });
  });

  it("takes the picture again at half the width when it is above 300 KB", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    const sizes = [MAX_IMAGE_CHARS + 1, 1024];
    hub.handle("game.run", () => ran({ image: png(sizes.shift() ?? 1), frame: 2, device: DEVICE }));
    const { result } = await run(screenshotTool, { maxWidth: 800, session: "s-1" });
    expect(hub.requests.map(entry => entry.params)).toEqual([
      { id: "editor.capture", input: { maxWidth: 800, format: "jpeg" } },
      { id: "editor.capture", input: { maxWidth: 400, format: "jpeg" } }
    ]);
    expect(jsonOf(result)).toEqual({ frame: 2, device: DEVICE, maxWidth: 400, kb: 1 });
  });

  it("answers a picture the page could not shrink anyway, with a note of its size", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.run", () =>
      ran({ image: png(MAX_IMAGE_CHARS + 1024), frame: 3, device: DEVICE })
    );
    const { result } = await run(screenshotTool);
    expect(hub.requests).toHaveLength(2);
    expect(jsonOf(result)).toMatchObject({
      maxWidth: 540,
      kb: 301,
      note: "the picture is 301 KB, above the 300 KB a result should carry"
    });
    expect(result.content[1]).toMatchObject({ type: "image" });
  });

  it("halves from the picture's own width when it is narrower than maxWidth", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    const images = [pngOf(393, MAX_IMAGE_CHARS + 1), png(2048)];
    hub.handle("game.run", () => ran({ image: images.shift() ?? "", frame: 4, device: DEVICE }));
    const { result } = await run(screenshotTool);
    expect(hub.requests.map(entry => entry.params)).toEqual([
      { id: "editor.capture", input: { maxWidth: 1080, format: "jpeg" } },
      { id: "editor.capture", input: { maxWidth: 196, format: "jpeg" } }
    ]);
    expect(jsonOf(result)).toEqual({ frame: 4, device: DEVICE, maxWidth: 196, kb: 2 });
  });

  it("reads the width of a JPEG to halve it, and answers it as image/jpeg", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    const images = [jpegOf(393, MAX_IMAGE_CHARS + 1), jpegOf(196, 2048, 0xc2)];
    hub.handle("game.run", () => ran({ image: images.shift() ?? "", frame: 5, device: DEVICE }));
    const { result } = await run(screenshotTool);
    expect(hub.requests.map(entry => entry.params)).toEqual([
      { id: "editor.capture", input: { maxWidth: 1080, format: "jpeg" } },
      { id: "editor.capture", input: { maxWidth: 196, format: "jpeg" } }
    ]);
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
  });

  it("crops to an element key and takes a PNG when asked", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.run", () => ran({ image: png(8), frame: 6, device: DEVICE }));
    const { result } = await run(screenshotTool, {
      key: "hud/coins",
      format: "png",
      maxWidth: 540
    });
    expect(hub.requests[0]?.params).toEqual({
      id: "editor.capture",
      input: { maxWidth: 540, format: "png", key: "hud/coins" }
    });
    expect(jsonOf(result)).toEqual({
      frame: 6,
      device: DEVICE,
      key: "hud/coins",
      maxWidth: 540,
      kb: 0
    });
    expect(result.content[1]).toMatchObject({ mimeType: "image/png" });
  });

  it("passes the agent's error for an unknown key through", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.run", () => {
      throw wireError(-32_602, "[moku-editor] editor.capture: no element with key nope", {
        reason: "invalid_input",
        field: "key"
      });
    });
    const { result } = await run(screenshotTool, { key: "nope" });
    expect(result).toEqual({
      content: [{ type: "text", text: "editor.capture: no element with key nope" }],
      isError: true
    });
  });

  it("does not retry below the narrowest width", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.run", () =>
      ran({ image: png(MAX_IMAGE_CHARS + 1), frame: 3, device: DEVICE })
    );
    await run(screenshotTool, { maxWidth: 64 });
    expect(hub.requests).toHaveLength(1);
  });

  it("answers isError when the shot carries no picture", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    hub.handle("game.run", () => ran({ nope: true }));
    const { result } = await run(screenshotTool);
    expect(result).toEqual({
      content: [{ type: "text", text: "editor.capture answered no picture." }],
      isError: true
    });
  });
});

describe("moku_series", () => {
  it("runs editor.sheet as JPEG at maxWidth 1080 when the agent has it, and answers the sheet", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.manifest", () => manifest({ sheet: "json?" }, [SHEET_COMMAND]));
    hub.handle("game.run", () => ran({ image: png(6), frame: 1902, device: DEVICE }, 1902));
    const { result, progress } = await run(seriesTool, { frames: 4, everyMs: 100 });
    expect(hub.requests[1]).toMatchObject({
      method: "run",
      params: {
        id: "editor.sheet",
        input: { frames: 4, everyMs: 100, maxWidth: 1080, format: "jpeg" }
      }
    });
    expect(hub.requests).toHaveLength(2);
    expect(jsonOf(result)).toEqual({
      frames: 4,
      everyMs: 100,
      columns: 2,
      frame: 1902,
      maxWidth: 1080,
      kb: 0
    });
    expect(result.content[1]).toEqual({
      type: "image",
      data: "A".repeat(6),
      mimeType: "image/png"
    });
    expect(progress[0]).toEqual([0, 400]);
  });

  it("answers isError when editor.sheet answers no picture", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.manifest", () => manifest({ sheet: "json?" }, [SHEET_COMMAND]));
    hub.handle("game.run", () => ran({ nope: true }));
    const { result } = await run(seriesTool);
    expect(result.isError).toBe(true);
    expect(textAt(result)).toContain("game.capture gave no picture");
  });

  it("does not run editor.sheet on a game older than 0.4", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.manifest", () => manifest({ legend: "boolean?" }, [SHEET_COMMAND]));
    const { result } = await run(seriesTool);
    expect(textAt(result)).toBe(
      "moku_series needs game.capture with a sheet option: @moku-labs/game 0.4 or newer"
    );
    expect(hub.requests.map(entry => entry.method)).toEqual(["manifest"]);
  });

  it("falls back to game.capture { sheet } without editor.sheet ({ png } of game 0.4)", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.manifest", () => manifest({ legend: "boolean?", sheet: "json?" }));
    hub.handle("game.run", () => ran({ png: png(4) }, 1900));
    const { result, progress } = await run(seriesTool, { frames: 4, everyMs: 100 });
    expect(hub.requests[1]?.params).toEqual({
      id: "game.capture",
      input: { sheet: { frames: 4, everyMs: 100 } }
    });
    expect(jsonOf(result)).toEqual({ frames: 4, everyMs: 100, columns: 2, frame: 1900, kb: 0 });
    expect(result.content[1]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
    expect(progress[0]).toEqual([0, 400]);
  });

  it("takes the PNG data URL itself (the pictureOf rule) and defaults to 6 frames every 500 ms", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.manifest", () => manifest({ sheet: "json?" }));
    hub.handle("game.run", () => ran(png(4)));
    const { result } = await run(seriesTool);
    expect(jsonOf(result)).toMatchObject({ frames: 6, everyMs: 500, columns: 3 });
  });

  it("answers isError for a game older than 0.4 (no sheet) and for no picture", async () => {
    const { run, hub } = await ready({ sessions: [LIVE] });
    hub.handle("game.manifest", () => manifest({}));
    const old = await run(seriesTool);
    expect(textAt(old.result)).toBe(
      "moku_series needs game.capture with a sheet option: @moku-labs/game 0.4 or newer"
    );
    hub.handle("game.manifest", () => manifest({ sheet: "json?" }));
    hub.handle("game.run", () => ran(null));
    const inert = await run(seriesTool);
    expect(inert.result.isError).toBe(true);
    expect(textAt(inert.result)).toContain("game.capture gave no picture");
  });
});

describe("moku_reference", () => {
  it("answers the newest card and its crop", async () => {
    const current = await ready();
    await serveCards(current, [
      { name: "old-f1.md", text: "# old", at: 1000 },
      { name: "claim-f25.md", text: "# @moku claim\n![element](claim-f25.png)", at: 2000 }
    ]);
    const { result } = await current.run(referenceTool);
    expect(textAt(result)).toBe(
      ".moku/captures/claim-f25.md\n\n# @moku claim\n![element](claim-f25.png)"
    );
    expect(result.content[1]).toEqual({
      type: "image",
      data: "A".repeat(12),
      mimeType: "image/png"
    });
    expect(current.hub.requests.at(-1)).toMatchObject({
      method: "readBinary",
      params: { path: ".moku/captures/claim-f25.png" }
    });
  });

  it("answers a named card without a crop link as text only", async () => {
    const current = await ready();
    await serveCards(current, [
      { name: "old-f1.md", text: "# old", at: 1000 },
      { name: "claim-f25.md", text: "# claim", at: 2000 }
    ]);
    const { result } = await current.run(referenceTool, { id: "old-f1" });
    expect(result.content).toEqual([{ type: "text", text: ".moku/captures/old-f1.md\n\n# old" }]);
  });

  it("keeps the card when its crop cannot be read", async () => {
    const current = await ready();
    await serveCards(current, [{ name: "a.md", text: "![element](gone.png)", at: 1 }]);
    current.hub.handle("files.readBinary", () => {
      throw new Error("not found");
    });
    const { result } = await current.run(referenceTool, { id: ".moku/captures/a.md" });
    expect(result.content).toHaveLength(1);
  });

  it("never reads a crop link that points at the bin's private files", async () => {
    const current = await ready();
    await serveCards(current, [{ name: "a.md", text: "![element](../editor.json)", at: 1 }]);
    const { result } = await current.run(referenceTool);
    expect(result.content).toHaveLength(1);
    expect(current.hub.requests.some(entry => entry.method === "readBinary")).toBe(false);
  });

  it("answers isError without cards, and for an unknown card", async () => {
    const current = await ready();
    current.hub.handle("files.list", () => {
      throw new Error("no such folder");
    });
    const none = await current.run(referenceTool);
    expect(textAt(none.result)).toContain("no reference cards in .moku/captures yet");

    await serveCards(current, [{ name: "a.md", text: "# a", at: 1 }]);
    const unknown = await current.run(referenceTool, { id: "b" });
    expect(textAt(unknown.result)).toBe(
      "no reference card b in .moku/captures; the cards are: .moku/captures/a.md"
    );
  });
});
