import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StyleEditCode } from "../../../panels/shared/style-edit";
import { actionsOf } from "../../actions";
import { styleErrorText } from "../../inspector/styles";
import { createTestCtx, flush, holdReads } from "../ctx";

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
  it("loads one card per text-style key and selects the first or the asked key", async () => {
    const { ctx } = createTestCtx({ files: { [STYLES]: fixture } });
    await actionsOf(ctx).inspector.openStyles();
    const styles = ctx.state.inspector.styles;
    expect(styles?.blocks.length).toBeGreaterThan(10);
    expect(styles?.key).toBe("ui.title");
    await actionsOf(ctx).inspector.openStyles("ui.number");
    expect(ctx.state.inspector.styles?.key).toBe("ui.number");
    actionsOf(ctx).inspector.selectStyle("ui.plank");
    expect(ctx.state.inspector.styles?.key).toBe("ui.plank");
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

  it("a missing file shows the no-file reason", async () => {
    const { ctx } = createTestCtx();
    await actionsOf(ctx).inspector.openStyles();
    expect(ctx.state.inspector.styles?.error?.error).toBe("no-file");
    expect(styleErrorText({ error: "no-file" }, STYLES)).toBe(
      "No text styles at features/ui/styles.ts · set flowView.stylesFile"
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
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Saved", STYLES);
    expect(ctx.state.inspector.styles?.result).toEqual({
      ok: true,
      text: "✓ Written to features/ui/styles.ts:74 · game reloaded · state restored"
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
});

describe("styleErrorText", () => {
  it("has flowView's text for every shared code", () => {
    const rows: [StyleEditCode, string][] = [
      ["no-file", "No text styles at features/ui/styles.ts · set flowView.stylesFile"],
      ["parse", "Can't read features/ui/styles.ts safely · Open in Files"],
      ["no-key", "ui.number is no longer in features/ui/styles.ts · list refreshed"],
      ["ambiguous", "ui.number appears twice in features/ui/styles.ts · edit it in Files"],
      ["not-literal", "size is not a number literal at features/ui/styles.ts:74"],
      ["read-only", "size has no edit rule · edit it in Files"],
      ["changed-on-disk", "The file changed on disk · Reload card"],
      ["out-of-range", "size is out of range · not written"]
    ];
    for (const [code, text] of rows) {
      expect(
        styleErrorText({ error: code, key: "ui.number", path: "size", line: 74 }, STYLES)
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
