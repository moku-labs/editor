import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StyleEditCode } from "../../../panels/shared/style-edit";
import { STYLE_BROKEN_TEXT } from "../../../panels/shared/style-edit";
import { actionsOf } from "../../actions";
import { styleErrorText } from "../../inspector/styles";
import { createTestCtx, flush, holdReads, memoryFiles, projectOf } from "../ctx";

const STYLES = "features/ui/styles.ts";
const fixture = readFileSync(new URL("../fixtures/ui-styles.txt", import.meta.url), "utf8");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the debounce fire and the write settle. */
async function settle(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("openStyles", () => {
  it("loads one card per text-style key, chooses none until asked (finding 9), then the asked key", async () => {
    const { ctx } = createTestCtx({ files: { [STYLES]: fixture } });
    await actionsOf(ctx).inspector.openStyles();
    const styles = ctx.state.inspector.styles;
    expect(styles?.blocks.length).toBeGreaterThan(10);
    expect(styles?.file).toBe(STYLES);
    expect(styles?.key).toBeUndefined();
    await actionsOf(ctx).inspector.openStyles("ui.number");
    expect(ctx.state.inspector.styles?.key).toBe("ui.number");
    actionsOf(ctx).inspector.selectStyle("ui.plank");
    expect(ctx.state.inspector.styles?.key).toBe("ui.plank");
    actionsOf(ctx).inspector.selectStyle("");
    expect(ctx.state.inspector.styles?.key).toBeUndefined();
  });

  it("a late load keeps the chosen card and the pending step, so the step is written", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles();
    const release = holdReads(fakes.files, STYLES);
    const late = inspector.openStyles();
    inspector.selectStyle("ui.number");
    inspector.stepStyle("size", 1, false);
    release();
    await late;
    expect(ctx.state.inspector.styles?.key).toBe("ui.number");
    expect(ctx.state.inspector.styles?.pending?.next).toBe(61);
    await settle(600);
    expect(fakes.files.writes).toHaveLength(1);
    expect((fakes.files.writes[0]?.text ?? "").split("\n")[73]).toBe("    size: 61,");
  });

  it("an asked key still wins over the chosen card", async () => {
    const { ctx } = createTestCtx({ files: { [STYLES]: fixture } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles();
    inspector.selectStyle("ui.plank");
    await inspector.openStyles("ui.number");
    expect(ctx.state.inspector.styles?.key).toBe("ui.number");
  });

  it("a styles file the index names but the disk lacks shows the no-file reason", async () => {
    const { ctx } = createTestCtx();
    await actionsOf(ctx).inspector.openStyles();
    expect(ctx.state.inspector.styles?.error?.error).toBe("no-file");
    expect(ctx.state.inspector.styles?.file).toBe(STYLES);
  });
});

/** The text of a game file that defines the text styles. */
const DEFINES = 'export const textStyles = defineTextStyles({\n  "ui.number": { size: 60 }\n});\n';

describe("the styles file comes from the project index", () => {
  it("reads the file that defines the most textStyle: keys, wherever it is", async () => {
    const { ctx, fakes } = createTestCtx({
      files: { "src/plugins/text/styles.ts": DEFINES, "src/ui/other.ts": DEFINES },
      index: {
        "textStyle:ui.number": [{ path: "src/plugins/text/styles.ts", line: 2 }],
        "textStyle:ui.title": [{ path: "src/plugins/text/styles.ts", line: 9 }],
        "textStyle:ui.body": [{ path: "src/ui/other.ts", line: 2 }]
      }
    });
    await actionsOf(ctx).inspector.openStyles();
    expect(ctx.state.inspector.styles?.file).toBe("src/plugins/text/styles.ts");
    expect(ctx.state.inspector.styles?.blocks.map(block => block.ref)).toEqual([
      { kind: "text", key: "ui.number" }
    ]);
    expect(fakes.files.list).not.toHaveBeenCalled();
  });

  it("an index with no text style: no cards, the reason says so, the Styles group stays empty", async () => {
    const { ctx, fakes } = createTestCtx({ files: { "game/styles.ts": DEFINES }, index: {} });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles();
    expect(ctx.state.inspector.styles).toMatchObject({ file: undefined, blocks: [] });
    expect(ctx.state.inspector.styles?.error).toEqual({ error: "no-file" });
    expect(styleErrorText({ error: "no-file" }, undefined, fakes.link.project())).toBe(
      "Not in the project index: text styles"
    );
    await inspector.readStyleKeys();
    expect(fakes.palette).toEqual([]);
    expect(fakes.files.list).not.toHaveBeenCalled();
  });

  it("an index that is off: the reason is the off line", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    fakes.files.off = "typescript is not installed";
    await actionsOf(ctx).inspector.openStyles();
    expect(ctx.state.inspector.styles?.file).toBeUndefined();
    expect(styleErrorText({ error: "no-file" }, undefined, fakes.link.project())).toBe(
      "Project index is off: typescript is not installed"
    );
    expect(styleErrorText({ error: "no-file" }, undefined, undefined)).toBe(
      "Project index is off: no state from the server yet"
    );
  });
});

describe("stepStyle", () => {
  it("a burst of size presses 60 → 64 is one writeNumber with the card's version, then one reload", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.number");
    for (let press = 0; press < 4; press += 1) inspector.stepStyle("size", 1, false);
    expect(ctx.state.inspector.styles?.pending?.next).toBe(64);
    expect(ctx.state.inspector.styles?.result).toEqual({ ok: true, text: "Writing…" });
    expect(fakes.files.writes).toEqual([]);
    await settle(600);
    expect(fakes.files.writes).toHaveLength(1);
    expect(fakes.files.writes[0]?.version).toBe("v1");
    const before = fixture.split("\n");
    const after = (fakes.files.writes[0]?.text ?? "").split("\n");
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [index + 1]));
    expect(changed).toEqual([74]);
    expect(after[73]).toBe("    size: 64,");
    expect(fakes.reload).toHaveBeenCalledTimes(1);
    expect(fakes.reload).toHaveBeenCalledWith({
      restore: true,
      afterSave: true,
      since: expect.any(Number)
    });
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Saved", STYLES);
    expect(ctx.state.inspector.styles?.result).toEqual({
      ok: true,
      text: "✓ Written to features/ui/styles.ts:74 · game reloaded · state restored"
    });
  });

  it("hands the reload the moment taken before the write (A2)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(1_759_680_000_000);
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    const write = vi.mocked(fakes.files.write).getMockImplementation();
    let writeStartedAt = 0;
    vi.mocked(fakes.files.write).mockImplementationOnce(async (path, text, version) => {
      // The write takes half a second: a moment taken after it would be later.
      writeStartedAt = Date.now();
      vi.setSystemTime(writeStartedAt + 500);
      if (write === undefined) throw new Error("no write");
      return write(path, text, version);
    });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.number");
    inspector.stepStyle("size", 1, false);
    await settle(600);
    expect(writeStartedAt).toBeGreaterThan(0);
    expect(fakes.reload).toHaveBeenCalledWith({
      restore: true,
      afterSave: true,
      since: writeStartedAt
    });
  });

  it("a write the game hot swapped says game updated (U10)", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    fakes.reload.mockResolvedValueOnce({ restored: false, reason: "hot_swap" });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.number");
    inspector.stepStyle("size", 1, false);
    await settle(600);
    expect(ctx.state.inspector.styles?.result).toEqual({
      ok: true,
      text: "✓ Written to features/ui/styles.ts:74 · game updated"
    });
  });

  it("steppers exist only for fields with a shared rule: wrap steps, an unknown number is read-only", async () => {
    const text = fixture.replace(
      '"ui.body": { font: "ui.font-body", size: 52,',
      '"ui.body": { font: "ui.font-body", weight: 700, size: 52,'
    );
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: text } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.paragraph");
    inspector.stepStyle("wrap", -1, true);
    expect(ctx.state.inspector.styles?.pending?.next).toBe(510);
    await settle(600);
    expect(fakes.files.writes).toHaveLength(1);
    inspector.selectStyle("ui.body");
    inspector.stepStyle("weight", 1, false);
    expect(ctx.state.inspector.styles?.error).toEqual({ error: "read-only", path: "weight" });
    await settle(600);
    expect(fakes.files.writes).toHaveLength(1);
  });

  it("clamps at the bound and writes nothing when the file changed under the card", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.number");
    const block = ctx.state.inspector.styles?.blocks.find(
      entry => entry.ref.kind === "text" && entry.ref.key === "ui.number"
    );
    expect(block?.fields.some(field => field.path === "size")).toBe(true);
    fakes.files.store.set(STYLES, {
      text: fixture.replace(
        "    size: 60,\n    fill: cream,\n    stroke: ink,\n    strokeWidth: 5,",
        "    size: 61,\n    fill: cream,\n    stroke: ink,\n    strokeWidth: 5,"
      ),
      version: "v7"
    });
    inspector.stepStyle("size", 1, false);
    await settle(600);
    expect(ctx.state.inspector.styles?.error?.error).toBe("changed-on-disk");
    expect(ctx.state.inspector.styles?.result?.text).toBe("The file changed on disk · Reload card");
    expect(fakes.reload).not.toHaveBeenCalled();
  });

  it("a file that does not parse now is not written; the card says why (D-44)", async () => {
    const { ctx, fakes } = createTestCtx({
      files: { [STYLES]: fixture },
      index: { "textStyle:ui.number": [{ path: STYLES, line: 73, broken: true }] }
    });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.number");
    inspector.stepStyle("size", 1, false);
    await settle(600);
    expect(fakes.files.writes).toEqual([]);
    expect(ctx.state.inspector.styles?.error).toEqual({ error: "broken", path: STYLES });
    expect(ctx.state.inspector.styles?.result).toEqual({ ok: false, text: STYLE_BROKEN_TEXT });
    expect(fakes.reload).not.toHaveBeenCalled();
  });

  it("an index that went off before the write: nothing written, the card shows the off line (D-48)", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.number");
    inspector.stepStyle("size", 1, false);
    fakes.files.off = "typescript is not installed";
    await settle(600);
    expect(fakes.files.writes).toEqual([]);
    expect(ctx.state.inspector.styles?.error).toEqual({ error: "index-off", path: STYLES });
    expect(ctx.state.inspector.styles?.result).toEqual({
      ok: false,
      text: "Project index is off: typescript is not installed"
    });
    expect(fakes.reload).not.toHaveBeenCalled();
  });
});

describe("styleErrorText", () => {
  it("has flowView's text for every shared code", () => {
    const rows: [StyleEditCode, string][] = [
      ["no-file", "No text styles at features/ui/styles.ts"],
      ["parse", "Can't read features/ui/styles.ts safely · Open in Files"],
      ["no-key", "ui.number is no longer in features/ui/styles.ts · list refreshed"],
      ["ambiguous", "ui.number appears twice in features/ui/styles.ts · edit it in Files"],
      ["not-literal", "size is not a number literal at features/ui/styles.ts:74"],
      ["read-only", "size has no edit rule · edit it in Files"],
      ["changed-on-disk", "The file changed on disk · Reload card"],
      ["out-of-range", "size is out of range · not written"],
      ["broken", STYLE_BROKEN_TEXT],
      ["index-off", "Project index is off"]
    ];
    for (const [code, text] of rows) {
      expect(
        styleErrorText(
          { error: code, key: "ui.number", path: "size", line: 74 },
          STYLES,
          projectOf(memoryFiles())
        )
      ).toBe(text);
    }
  });
});

describe("readStyleKeys and the palette group Styles", () => {
  it("adds one item per key; a re-read replaces them; running one opens the Styles tab on it", async () => {
    vi.useRealTimers();
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixture } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.readStyleKeys();
    const items = fakes.palette.at(-1) ?? [];
    expect(items.every(item => item.group === "Styles")).toBe(true);
    expect(items.map(item => item.label)).toContain("ui.number");
    await inspector.readStyleKeys();
    expect(fakes.removed).toContain(0);
    const number = (fakes.palette.at(-1) ?? []).find(item => item.label === "ui.number");
    number?.run();
    await flush(5);
    expect(fakes.workspace.show).toHaveBeenCalledWith("flow");
    expect(ctx.state.inspector.tab).toBe("styles");
    expect(ctx.state.inspector.styles?.key).toBe("ui.number");
  });

  it("a missing file adds no style items", async () => {
    vi.useRealTimers();
    const { ctx, fakes } = createTestCtx();
    await actionsOf(ctx).inspector.readStyleKeys();
    expect(fakes.palette.flat().filter(item => item.group === "Styles")).toEqual([]);
  });
});
