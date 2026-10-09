import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScene, type SceneSnapshot } from "../../../panels/shared/scene";
import { STYLE_BROKEN_TEXT, type StyleEditCode } from "../../../panels/shared/style-edit";
import { wireError } from "../../../registry/protocol";
import { openStyleCard, saveStyle, stepStyle, styleErrorText } from "../../element/styles";
import type { ElementRef } from "../../types";
import { answer, createCtx, flush, place, projectOn, sceneCapture, type TestCtx } from "../helpers";

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

/** The style key of the coin pill block in the index. */
const COIN_STYLE = "style:src/hud/styles.ts#coinPill";

beforeEach(() => {
  ctx = createCtx({ "src/hud/Hud.tsx": HUD, "src/hud/styles.ts": STYLES });
  ctx.link.projectValue = projectOn({ [COIN_STYLE]: ["src/hud/styles.ts"] });
  answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [3, 3, 3, 43]));
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

  it("asks the index for the key of the scene node (a pattern answer too)", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", "<Row>\n  <column key={id} />\n</Row>");
    answer(ctx, "jsx:orderCard0", place("src/hud/Hud.tsx", [2, 3, 2, 22], { key: "orderCard*" }));
    ctx.state.scene = withKey(boardScene(), "boardScreen/hudRow/coinPill", "orderCard0");
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "orderCard0",
      status: "defined",
      path: "src/hud/Hud.tsx",
      line: 2
    });
  });

  it("uses a defineStyle constant of the same file first when the index defines it there", async () => {
    ctx.link.files.put(
      "src/hud/Hud.tsx",
      'const coinPill = defineStyle({ height: 10 });\n<Pill key="coinPill" style={coinPill} />\n'
    );
    ctx.link.projectValue = projectOn({
      [COIN_STYLE]: ["src/hud/styles.ts"],
      "style:src/hud/Hud.tsx#coinPill": ["src/hud/Hud.tsx"]
    });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
    await openStyleCard(ctx, COIN);
    expect(ctx.state.styles?.path).toBe("src/hud/Hud.tsx");
  });

  it("shows the lookup, then missing when the index does not know the key", async () => {
    ctx.link.files.answers.delete("jsx:coinPill");
    const pending = openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "searching" });
    await pending;
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "missing" });
    expect(ctx.state.styles).toBeUndefined();
  });

  it("reports the shared module's refusal when the index defines no such block", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", '<Pill key="coinPill" style={nowhere} />');
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [1, 1, 1, 41]));
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "coinPill",
      status: "failed",
      path: "src/hud/Hud.tsx",
      error: { error: "no-key", key: "nowhere" }
    });
  });

  it("reports missing when the index is off or the key file cannot be read", async () => {
    vi.spyOn(ctx.link.files, "find").mockRejectedValueOnce(new Error("project index off"));
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "missing" });

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
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [1, 1, 4, 3], { line: 2 }));
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

  it("shows the style call of an id prop's component read-only, at the file and line of the call", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", '<Pill\n  id="coinPill"\n/>');
    ctx.link.files.put(
      "src/kit/pill.tsx",
      "<row\n  key={props.id}\n  style={pillOf(props.width)}\n/>"
    );
    answer(
      ctx,
      "jsx:coinPill",
      place("src/hud/Hud.tsx", [1, 1, 3, 3], {
        line: 2,
        kind: "idProp",
        component: "Pill",
        prop: "id"
      }),
      place("src/kit/pill.tsx", [1, 1, 4, 3], {
        line: 2,
        kind: "ident",
        key: "{id}",
        component: "Pill"
      })
    );
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "coinPill",
      status: "call",
      path: "src/kit/pill.tsx",
      line: 3,
      call: "pillOf(props.width)"
    });
  });

  it("says where the key is defined when its element has no style", async () => {
    ctx.link.files.put("src/hud/Hud.tsx", '<Row>\n  <HudPill id="coinPill" />\n</Row>');
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 3, 2, 27], { kind: "idProp" }));
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({
      key: "coinPill",
      status: "defined",
      path: "src/hud/Hud.tsx",
      line: 2
    });
  });

  it("says the style file does not parse now when the index lists it broken (D-44)", async () => {
    ctx.link.projectValue = projectOn(
      { [COIN_STYLE]: ["src/hud/styles.ts"] },
      { broken: { "src/hud/styles.ts": "src/hud/styles.ts:4:3 ',' expected" } }
    );
    await openStyleCard(ctx, COIN);
    expect(ctx.state.styles?.error).toEqual({ error: "broken", path: "src/hud/styles.ts" });

    ctx.link.files.put("src/hud/styles.ts", "export const coinPill = defineStyle({ height: ");
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toMatchObject({
      status: "failed",
      error: { error: "broken", path: "src/hud/styles.ts" }
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
    expect(ctx.workspace.reload).toHaveBeenCalledWith({
      restore: true,
      afterSave: true,
      since: expect.any(Number)
    });
    expect(ctx.state.styles?.pending).toBeUndefined();
    expect(ctx.state.styles?.current.version).toBe(ctx.link.files.version("src/hud/styles.ts"));
    expect(ctx.state.styles?.block.fields.find(field => field.path === "height")).toMatchObject({
      value: 88
    });
  });

  it("hands the reload the moment taken before the write (A2)", async () => {
    const { files } = ctx.link;
    const write = files.write.bind(files);
    let writeStartedAt = 0;
    vi.spyOn(files, "write").mockImplementationOnce((path, text, version) => {
      // The write takes half a second: a moment taken after it would be later.
      writeStartedAt = Date.now();
      vi.setSystemTime(writeStartedAt + 500);
      return write(path, text, version);
    });
    stepStyle(ctx, "height", 1, false);
    await vi.advanceTimersByTimeAsync(400);
    expect(writeStartedAt).toBeGreaterThan(0);
    expect(ctx.workspace.reload).toHaveBeenCalledWith({
      restore: true,
      afterSave: true,
      since: writeStartedAt
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

  it("writes nothing while the index answers the block from a broken file, and says so", async () => {
    answer(ctx, COIN_STYLE, place("src/hud/styles.ts", [3, 1, 8, 3], { broken: true }));
    stepStyle(ctx, "height", 1, false);
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.link.files.writes).toEqual([]);
    expect(ctx.state.styles?.error).toEqual({ error: "broken", path: "src/hud/styles.ts" });
    expect(
      styleErrorText({ error: "broken", path: "src/hud/styles.ts" }, ctx.link.projectValue)
    ).toBe(STYLE_BROKEN_TEXT);
  });

  it("writes nothing while the index is off, and the card says why (D-48)", async () => {
    vi.spyOn(ctx.link.files, "find").mockRejectedValue(
      wireError(-32_008, "project index off: disabled", { reason: "not_installed" })
    );
    stepStyle(ctx, "height", 1, false);
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.link.files.writes).toEqual([]);
    expect(ctx.state.styles?.error).toEqual({ error: "index-off", path: "src/hud/styles.ts" });
    expect(
      styleErrorText(
        { error: "index-off", path: "src/hud/styles.ts" },
        {
          state: "off",
          reason: "disabled"
        }
      )
    ).toBe("Project index is off: disabled");
  });

  it("saveStyle without a pending edit does nothing", async () => {
    await saveStyle(ctx);
    expect(ctx.link.files.writes).toEqual([]);
  });
});

describe("a style a function builds (G2)", () => {
  const KIT = "src/hud/kit.tsx";
  const ICON_KEY = "style:src/hud/kit.tsx#roundStylesOf.icon";
  const BOARD_KEY = "style:src/hud/kit.tsx#signboardStyle";
  const KIT_TEXT = [
    'import { defineStyle } from "../kit";',
    "",
    "export function roundStylesOf(size: number) {",
    "  return {",
    "    icon: defineStyle({ width: 40, height: 40 })",
    "  };",
    "}",
    "",
    "export function signboardStyle(hung: boolean) {",
    "  if (!hung) return defineStyle(board);",
    "  return defineStyle({",
    "    ...board,",
    "    gap: 12",
    "  });",
    "}",
    ""
  ].join("\n");

  /**
   * Styles the coin pill with a call and lets the index know the function's keys.
   *
   * @param call - The style attribute's call.
   */
  function styledBy(call: string): void {
    ctx.link.files.put(
      "src/hud/Hud.tsx",
      `import { roundStylesOf, signboardStyle } from "./kit";\n<Pill\n  key="coinPill"\n  style={${call}}\n/>`
    );
    ctx.link.files.put(KIT, KIT_TEXT);
    ctx.link.projectValue = projectOn({ [ICON_KEY]: [KIT], [BOARD_KEY]: [KIT] });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 5, 3], { line: 3 }));
    answer(ctx, ICON_KEY, place(KIT, [5, 11, 5, 49], { binding: "roundStylesOf", key: "icon" }));
    answer(
      ctx,
      BOARD_KEY,
      place(KIT, [10, 21, 10, 41], { binding: "signboardStyle" }),
      place(KIT, [11, 10, 14, 5], { binding: "signboardStyle" })
    );
  }

  it("shows an editable card at the defineStyle call the index answers", async () => {
    styledBy("roundStylesOf(76).icon");
    await openStyleCard(ctx, COIN);

    expect(ctx.state.lookup).toBeUndefined();
    expect(ctx.state.styles).toMatchObject({
      path: KIT,
      current: { text: KIT_TEXT, version: ctx.link.files.version(KIT) },
      ref: { kind: "call", name: "roundStylesOf.icon", line: 5, column: 11 },
      block: { line: 5, endLine: 5 },
      error: undefined
    });
  });

  it("takes the first call of the function that has an object to edit", async () => {
    styledBy("signboardStyle(true)");
    await openStyleCard(ctx, COIN);

    expect(ctx.state.styles).toMatchObject({
      ref: { kind: "call", name: "signboardStyle", line: 11, column: 10 },
      block: { line: 11, endLine: 14 }
    });
  });

  it("a step writes the literal in the call and nothing else", async () => {
    styledBy("roundStylesOf(76).icon");
    await openStyleCard(ctx, COIN);
    vi.useFakeTimers();

    stepStyle(ctx, "width", 1, false);
    await vi.advanceTimersByTimeAsync(400);

    const text = ctx.link.files.text(KIT);
    expect(text).toBe(KIT_TEXT.replace("width: 40, height: 40", "width: 41, height: 40"));
    expect(ctx.state.styles?.block.fields.find(field => field.path === "width")).toMatchObject({
      value: 41
    });
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Saved", KIT);
  });

  it("writes nothing while the index answers the call from a broken file", async () => {
    styledBy("roundStylesOf(76).icon");
    await openStyleCard(ctx, COIN);
    answer(ctx, ICON_KEY, place(KIT, [5, 11, 5, 49], { broken: true }));
    vi.useFakeTimers();

    stepStyle(ctx, "height", 1, false);
    await vi.advanceTimersByTimeAsync(400);

    expect(ctx.link.files.writes).toEqual([]);
    expect(ctx.state.styles?.error).toEqual({ error: "broken", path: KIT });
  });

  it("stays a read-only call when the call has no object, or the index has no answer", async () => {
    styledBy("signboardStyle(false)");
    answer(ctx, BOARD_KEY, place(KIT, [10, 21, 10, 41], { binding: "signboardStyle" }));
    await openStyleCard(ctx, COIN);
    expect(ctx.state.styles).toBeUndefined();
    expect(ctx.state.lookup).toMatchObject({ status: "call", call: "signboardStyle(false)" });

    ctx.link.files.answers.delete(BOARD_KEY);
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toMatchObject({ status: "call", line: 4 });
  });

  it("shows the refusal when the file of the call does not parse", async () => {
    styledBy("roundStylesOf(76).icon");
    ctx.link.files.put(KIT, `${KIT_TEXT}function broken() {\n`);
    await openStyleCard(ctx, COIN);

    expect(ctx.state.lookup).toMatchObject({
      status: "failed",
      path: KIT,
      error: { error: "parse" }
    });
  });
});

describe("styleErrorText", () => {
  it("gives one line of gameView's own text for every code", () => {
    const codes: StyleEditCode[] = [
      "broken",
      "no-file",
      "parse",
      "no-key",
      "ambiguous",
      "not-literal",
      "read-only",
      "changed-on-disk",
      "out-of-range",
      "index-off"
    ];
    const project = projectOn();
    const texts = codes.map(error => styleErrorText({ error, line: 4, key: "coinPill" }, project));
    expect(new Set(texts).size).toBe(codes.length);
    for (const text of texts) expect(text).not.toContain("\n");
    expect(styleErrorText({ error: "no-key", key: "coinPill" }, project)).toBe(
      "No style block named coinPill."
    );
    expect(styleErrorText({ error: "index-off" }, project)).toBe("Project index is off");
    expect(styleErrorText({ error: "index-off" }, undefined)).toBe(
      "Project index is off: no state from the server yet"
    );
  });
});
