import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScene, type SceneSnapshot } from "../../../panels/shared/scene";
import type { StyleEditCode } from "../../../panels/shared/style-edit";
import { openStyleCard, saveStyle, stepStyle, styleErrorText } from "../../element/styles";
import type { ElementRef } from "../../types";
import { createCtx, flush, sceneCapture, type TestCtx, templateOf } from "../helpers";

const BOARD = sceneCapture("scene-board.txt");
const COIN: ElementRef = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
const HUD =
  'import { coinPill } from "./styles";\n<Row>\n  <Pill key="coinPill" style={coinPill} />\n</Row>\n';
const STYLES = [
  'import { defineStyle } from "../kit";',
  "",
  "export const coinPill = defineStyle({",
  "  height: 76,",
  "  radius: 38,",
  "  padding: { left: 20, right: 20 },",
  '  align: "center"',
  "});",
  ""
].join("\n");

/**
 * The board scene.
 *
 * @returns The snapshot.
 */
function boardScene(): SceneSnapshot {
  const scene = buildScene({ ...BOARD, frame: 1841, calibration: { scale: 1, x: 0, y: 0 } });
  if ("error" in scene) throw new Error("fixture");
  return scene;
}

/**
 * The scene with another key on one ui node.
 *
 * @param scene - The scene.
 * @param path - The ui path of the node.
 * @param key - Its new key.
 * @returns A copy of the scene.
 */
function withKey(scene: SceneSnapshot, path: string, key: string): SceneSnapshot {
  const nodes = new Map(scene.nodes);
  const node = nodes.get(`ui:${path}`);
  if (node === undefined) throw new Error("fixture");
  nodes.set(node.id, { ...node, key, name: key });
  return { ...scene, nodes };
}

let ctx: TestCtx;

beforeEach(() => {
  ctx = createCtx({ "src/hud/Hud.tsx": HUD, "src/hud/styles.ts": STYLES });
  ctx.state.scene = boardScene();
  ctx.state.selected = COIN;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openStyleCard", () => {
  it("finds the key, follows the style import and shows the defineStyle block", async () => {
    await openStyleCard(ctx, COIN);

    expect(ctx.state.lookup).toBeUndefined();
    expect(ctx.state.styles).toMatchObject({
      path: "src/hud/styles.ts",
      current: { text: STYLES, version: ctx.link.files.version("src/hud/styles.ts") },
      ref: { kind: "const", name: "coinPill" },
      block: { line: 3, endLine: 8 },
      pending: undefined,
      error: undefined
    });
    expect(ctx.state.blocks.get("coinPill")).toEqual({ path: "src/hud/styles.ts", line: 3 });
  });

  it("keeps the block of a key even when the selection moved on meanwhile", async () => {
    const pending = openStyleCard(ctx, COIN);
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow" };
    await pending;
    expect(ctx.state.blocks.get("coinPill")).toEqual({ path: "src/hud/styles.ts", line: 3 });
  });

  it("says a key built in a loop is defined at the template literal (loop)", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", `const id = ${templateOf("orderCard", "slot")};`);
    ctx.state.scene = withKey(boardScene(), "boardScreen/hudRow/coinPill", "orderCard0");
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "orderCard0",
      status: "defined",
      path: "src/hud/Hud.tsx",
      line: 1,
      loop: true
    });
  });

  it("uses a defineStyle constant of the same file first", async () => {
    ctx.link.files.put(
      "src/hud/Hud.tsx",
      'const coinPill = defineStyle({ height: 10 });\n<Pill key="coinPill" style={coinPill} />\n'
    );
    await openStyleCard(ctx, COIN);
    expect(ctx.state.styles?.path).toBe("src/hud/Hud.tsx");
  });

  it("shows searching, then missing when no file has the key", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", "<Row />");
    const pending = openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "searching" });
    await pending;
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "missing" });
    expect(ctx.state.styles).toBeUndefined();
  });

  it("reports the shared module's refusal when the block is not found", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", '<Pill key="coinPill" style={nowhere} />');
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "coinPill",
      status: "failed",
      path: "src/hud/Hud.tsx",
      error: { error: "no-key", key: "nowhere" }
    });
  });

  it("logs a failing search and reports missing", async () => {
    vi.spyOn(ctx.link.files, "list").mockResolvedValueOnce([{ path: "src", kind: "dir", size: 0 }]);
    vi.spyOn(ctx.link.files, "read").mockRejectedValue(new Error("offline"));
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "missing" });
  });

  it("does nothing for an entity or a node without a key", async () => {
    await openStyleCard(ctx, { kind: "entity", id: 1_048_628 });
    expect(ctx.state.lookup).toBeUndefined();
    await openStyleCard(ctx, { kind: "ui", path: "nope" });
    expect(ctx.state.lookup).toBeUndefined();
    expect(ctx.state.styles).toBeUndefined();
  });

  it("shows a style computed by a call read-only, with the file and line of the call", async () => {
    ctx.link.files.put(
      "src/hud/Hud.tsx",
      '<Pill\n  key="coinPill"\n  style={pillOf(props.width, 2)}\n/>'
    );
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "coinPill",
      status: "call",
      path: "src/hud/Hud.tsx",
      line: 3,
      call: "pillOf(props.width, 2)"
    });
    expect(ctx.state.styles).toBeUndefined();
  });

  it("says where the key is defined when its element has no style", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", '<Row>\n  <HudPill id="coinPill" />\n</Row>');
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "coinPill",
      status: "defined",
      path: "src/hud/Hud.tsx",
      line: 2
    });
  });

  it("drops the result when the selection changed meanwhile", async () => {
    const pending = openStyleCard(ctx, COIN);
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow" };
    await pending;
    expect(ctx.state.styles).toBeUndefined();
  });
});

describe("stepStyle and saveStyle", () => {
  beforeEach(async () => {
    await openStyleCard(ctx, COIN);
    vi.useFakeTimers();
  });

  it("debounces a burst into one write with the version, toasts and reloads with restore", async () => {
    const write = vi.spyOn(ctx.link.files, "write");
    const version = ctx.link.files.version("src/hud/styles.ts");

    stepStyle(ctx, "height", 1, false);
    stepStyle(ctx, "height", 1, false);
    stepStyle(ctx, "height", 1, true);
    expect(ctx.state.styles?.pending).toEqual({ path: "height", raw: "76", next: 88 });
    await vi.advanceTimersByTimeAsync(400);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[2]).toBe(version);
    expect(ctx.link.files.text("src/hud/styles.ts")).toContain("  height: 88,");
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Saved", "src/hud/styles.ts");
    expect(ctx.workspace.reload).toHaveBeenCalledWith({ restore: true });
    expect(ctx.state.styles?.pending).toBeUndefined();
    expect(ctx.state.styles?.current.version).toBe(ctx.link.files.version("src/hud/styles.ts"));
    expect(ctx.state.styles?.block.fields.find(field => field.path === "height")).toMatchObject({
      value: 88
    });
  });

  it("keeps a number field without a fieldRule read-only", async () => {
    stepStyle(ctx, "radius", 1, false);
    stepStyle(ctx, "align", 1, false);
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.state.styles?.pending).toBeUndefined();
    expect(ctx.link.files.writes).toEqual([]);
  });

  it("writes nothing on a shared-module refusal and shows it on the card", async () => {
    stepStyle(ctx, "height", 1, false);
    ctx.link.files.put("src/hud/styles.ts", STYLES.replace("height: 76", "height: 90"));
    ctx.link.files.writes.length = 0;
    await vi.advanceTimersByTimeAsync(400);

    expect(ctx.link.files.writes).toEqual([]);
    expect(ctx.state.styles?.error).toEqual({ error: "changed-on-disk" });
    expect(ctx.workspace.reload).not.toHaveBeenCalled();
  });

  it("toasts a rejected write", async () => {
    vi.spyOn(ctx.link.files, "write").mockRejectedValue(new Error("[moku-editor] offline"));
    stepStyle(ctx, "height", -1, false);
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Save failed · offline");
  });

  it("saves the pending edit of another field first", async () => {
    stepStyle(ctx, "height", 1, false);
    stepStyle(ctx, "padding.left", 1, false);
    await flush();
    await vi.advanceTimersByTimeAsync(400);
    const text = ctx.link.files.text("src/hud/styles.ts");
    expect(text).toContain("height: 77");
    expect(text).toContain("left: 21");
  });

  it("saveStyle without a pending edit does nothing", async () => {
    await saveStyle(ctx);
    expect(ctx.link.files.writes).toEqual([]);
  });
});

describe("styleErrorText", () => {
  it("gives one line of gameView's own text for every code", () => {
    const codes: StyleEditCode[] = [
      "no-file",
      "parse",
      "no-key",
      "ambiguous",
      "not-literal",
      "read-only",
      "changed-on-disk",
      "out-of-range"
    ];
    const texts = codes.map(error => styleErrorText({ error, line: 4, key: "coinPill" }));
    expect(new Set(texts).size).toBe(codes.length);
    for (const text of texts) expect(text).not.toContain("\n");
    expect(styleErrorText({ error: "no-key", key: "coinPill" })).toBe(
      "No style block named coinPill."
    );
  });
});
