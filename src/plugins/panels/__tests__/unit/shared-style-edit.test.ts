import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FileText, ProjectFound, WriteResult } from "../../../registry/protocol";
import { wireError } from "../../../registry/protocol";
import type {
  EditTarget,
  NumberField,
  StyleBlock,
  StyleEditError,
  StyleField,
  StyleFile,
  StyleFiles
} from "../../shared/style-edit";
import {
  editNumber,
  fieldRule,
  findBlock,
  formatNumber,
  isStyleEditError,
  loadStyleFile,
  parseStyleFile,
  STYLE_BROKEN_TEXT,
  stepValue,
  writeNumber
} from "../../shared/style-edit";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: the merge-game style files, copied verbatim as .txt.
// ─────────────────────────────────────────────────────────────────────────────

const UI = readFileSync(new URL("../fixtures/ui-styles.txt", import.meta.url), "utf8");
const HUD = readFileSync(new URL("../fixtures/hud-styles.txt", import.meta.url), "utf8");
const UI_PATH = "features/ui/styles.ts";
/** The opening of a template-literal hole, written without tripping the template lint. */
const HOLE = `${"$"}{`;

const NUMBER_SIZE: EditTarget = {
  ref: { kind: "text", key: "ui.number" },
  path: "size",
  raw: "60"
};

function parsed(text: string): StyleFile {
  const file = parseStyleFile(text);
  if (isStyleEditError(file)) throw new Error(`fixture did not parse: ${file.error}`);
  return file;
}

function block(file: StyleFile, ref: StyleBlock["ref"]): StyleBlock {
  const found = findBlock(file, ref);
  if (isStyleEditError(found)) throw new Error(`no block: ${found.error}`);
  return found;
}

function field(found: StyleBlock, path: string): StyleField | undefined {
  return found.fields.find(item => item.path === path);
}

function numberField(found: StyleBlock, path: string): NumberField {
  const item = field(found, path);
  if (item?.kind !== "number") throw new Error(`${path} is not a number field`);
  return item;
}

function summary(found: StyleBlock): string[] {
  return found.fields.map(item => `${item.kind}:${item.path}=${item.raw}`);
}

function lines(text: string): string[] {
  return text.split("\n");
}

/** An in-memory files client with versions; queued failures reject the next calls in order. */
function fakeFiles(initial: Record<string, string>) {
  const texts = new Map(Object.entries(initial));
  const versions = new Map<string, number>();
  const writeFailures: unknown[] = [];
  const readFailures: unknown[] = [];
  const version = (path: string): string => `v${versions.get(path) ?? 1}`;

  const files: StyleFiles = {
    read: vi.fn(async (path: string): Promise<FileText> => {
      const failure = readFailures.shift();
      if (failure !== undefined) throw failure;
      const text = texts.get(path);
      if (text === undefined) throw wireError(-32_601, `unknown file: ${path}`);
      return { text, version: version(path) };
    }),
    write: vi.fn(async (path: string, text: string, expected?: string): Promise<WriteResult> => {
      const failure = writeFailures.shift();
      if (failure !== undefined) throw failure;
      if (expected !== undefined && expected !== version(path)) {
        throw wireError(-32_005, `version conflict: ${path}`);
      }
      texts.set(path, text);
      versions.set(path, (versions.get(path) ?? 1) + 1);
      return { path, bytes: text.length, version: version(path) };
    })
  };

  return {
    files,
    texts,
    writeFailures,
    readFailures,
    /** Changes the file on disk behind the editor's back. */
    touch(path: string, text: string) {
      texts.set(path, text);
      versions.set(path, (versions.get(path) ?? 1) + 1);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseStyleFile
// ─────────────────────────────────────────────────────────────────────────────

describe("parseStyleFile on the merge-game text styles", () => {
  const file = parsed(UI);

  it("finds every entry of the text-style table as a text block", () => {
    expect(file.blocks.map(item => item.ref)).toEqual(
      [
        "ui.title",
        "ui.button",
        "ui.button-small",
        "ui.plank",
        "ui.number",
        "ui.amount",
        "ui.tab",
        "ui.name",
        "ui.caption",
        "ui.body",
        "ui.paragraph",
        "ui.link",
        "ui.small",
        "ui.badge",
        "ui.badgeInk",
        "ui.logo",
        "ui.sign"
      ].map(key => ({ kind: "text", key }))
    );
    expect(file.eol).toBe("\n");
  });

  it("reads the colour constants written as 0x hex with separators", () => {
    expect([...file.colours]).toEqual([
      ["cream", "#fff3d6"],
      ["ink", "#3a2212"],
      ["softInk", "#5b3a20"],
      ["berry", "#8f2334"]
    ]);
  });

  it("gives the fields of a multi-line block with nested shadow fields", () => {
    const found = block(file, { kind: "text", key: "ui.number" });

    expect(found.line).toBe(72);
    expect(found.endLine).toBe(80);
    expect(summary(found)).toEqual([
      'other:font="ui.font-display"',
      "number:size=60",
      "other:fill=cream",
      "other:stroke=ink",
      "number:strokeWidth=5",
      "other:digits=true",
      "other:shadow.color=ink",
      "number:shadow.dx=0",
      "number:shadow.dy=8"
    ]);
  });

  it("gives the exact columns of a number literal", () => {
    const size = numberField(block(file, { kind: "text", key: "ui.number" }), "size");
    const line = lines(UI)[size.line - 1] ?? "";

    expect(size).toEqual({
      kind: "number",
      path: "size",
      value: 60,
      raw: "60",
      line: 74,
      colStart: 10,
      colEnd: 12
    });
    expect(line.slice(size.colStart, size.colEnd)).toBe("60");
  });

  it("reads several fields on one line", () => {
    const tab = block(file, { kind: "text", key: "ui.tab" });
    const size = numberField(tab, "size");

    expect(tab.line).toBe(92);
    expect(tab.endLine).toBe(92);
    expect(tab.fields.map(item => item.path)).toEqual(["font", "size", "fill", "align"]);
    expect(lines(UI)[91]?.slice(size.colStart, size.colEnd)).toBe("50");
  });

  it("reads a decimal literal", () => {
    const alpha = numberField(block(file, { kind: "text", key: "ui.button" }), "shadow.alpha");
    expect(alpha.value).toBe(0.55);
    expect(alpha.raw).toBe("0.55");
  });
});

describe("parseStyleFile on the merge-game layout style", () => {
  const file = parsed(HUD);

  it("finds the defineStyle constant as a const block", () => {
    expect(file.blocks.map(item => item.ref)).toEqual([{ kind: "const", name: "hudRow" }]);
    expect(file.blocks[0]?.line).toBe(15);
    expect(file.blocks[0]?.endLine).toBe(23);
    expect(file.colours.size).toBe(0);
  });

  it("gives identifiers as other fields and nested pairs as dotted numbers", () => {
    expect(summary(block(file, { kind: "const", name: "hudRow" }))).toEqual([
      'other:direction="row"',
      'other:align="center"',
      'other:justify="between"',
      'other:alignSelf="stretch"',
      "other:height=hudRowHeight",
      "number:margin.top=40",
      "number:padding.left=40",
      "number:padding.right=40"
    ]);
  });
});

describe("parseStyleFile scanner", () => {
  it("ignores braces in strings, template literals and comments", () => {
    const text = [
      "const card = defineStyle({",
      '  label: "}{",',
      String.raw`  hint: '{\'}',`,
      `  note: \`x ${HOLE} { a: 1 }.a } }\`,`,
      "  // }",
      "  /* } { */",
      "  width: 10",
      "});"
    ].join("\n");
    const card = block(parsed(text), { kind: "const", name: "card" });

    expect(card.endLine).toBe(8);
    expect(card.fields.map(item => item.path)).toEqual(["label", "hint", "note", "width"]);
    expect(numberField(card, "width").value).toBe(10);
  });

  it("keeps a nested template literal inside a template literal", () => {
    const text = `const a = defineStyle({ label: \`a ${HOLE}\`b ${HOLE} 1 }\`} }\`, width: 4 });`;
    const found = block(parsed(text), { kind: "const", name: "a" });
    expect(found.fields.map(item => item.path)).toEqual(["label", "width"]);
  });

  it("does not start a block inside a comment", () => {
    const text = ["/*", '  "ui.ghost": {', "*/", '// "ui.other": {', "const x = 1;"].join("\n");
    expect(parsed(text).blocks).toEqual([]);
  });

  it("reads shorthands, spreads, quoted keys, expressions and negative literals", () => {
    const text = [
      "export const card = defineStyle({",
      "  ...base,",
      "  ink,",
      "  'minWidth': 12, \"maxWidth\": 900,",
      "  height: BIG * 2,",
      "  left: -4,",
      "  top: 0xff_f3_d6,",
      "  grow: 1.5 // a comment",
      "  ,shrink: 1",
      "});"
    ].join("\n");

    expect(summary(block(parsed(text), { kind: "const", name: "card" }))).toEqual([
      "other:...base=...base",
      "other:ink=ink",
      "number:minWidth=12",
      "number:maxWidth=900",
      "other:height=BIG * 2",
      "number:left=-4",
      "other:top=0xff_f3_d6",
      "number:grow=1.5",
      "number:shrink=1"
    ]);
  });

  it("keeps objects and arrays deeper than one level as one other field up to 40 characters", () => {
    const text = [
      "const card = defineStyle({",
      "  when: { landscape: { width: 1, height: 2, minWidth: 3, maxWidth: 4, gap: 5 } },",
      "  list: [1, 2],",
      "  value:",
      "    8",
      "});"
    ].join("\n");
    const card = block(parsed(text), { kind: "const", name: "card" });
    const deep = field(card, "when.landscape");

    expect(deep?.kind).toBe("other");
    expect(deep?.raw).toHaveLength(40);
    expect(deep?.raw.startsWith("{ width: 1")).toBe(true);
    expect(field(card, "list")).toMatchObject({ kind: "other", raw: "[1, 2]" });
    expect(field(card, "value")).toMatchObject({ kind: "number", raw: "8", line: 5 });
  });

  it("reads CRLF files with the same columns", () => {
    const file = parsed(UI.replaceAll("\n", "\r\n"));
    const size = numberField(block(file, { kind: "text", key: "ui.number" }), "size");

    expect(file.eol).toBe("\r\n");
    expect(size).toMatchObject({ line: 74, colStart: 10, colEnd: 12 });
  });

  it("reads string colour constants in lower case", () => {
    const text = [
      'export const sky = "#AABBCC";',
      "const sea = '#112233';",
      'const bad = "#12";',
      "const long = 0x1234567;"
    ].join("\n");
    expect([...parsed(text).colours]).toEqual([
      ["sky", "#aabbcc"],
      ["sea", "#112233"]
    ]);
  });

  it("returns a parse error for a block that never closes", () => {
    const text = ["const x = 1;", "const card = defineStyle({", "  width: 1,", ""].join("\n");
    expect(parseStyleFile(text)).toEqual({ error: "parse", line: 2 });
  });

  it("returns a parse error for braces that never balance", () => {
    expect(parseStyleFile("const a = {\n  b: 1\n")).toEqual({ error: "parse", line: 1 });
    expect(parseStyleFile("const a = 1;\n}\n")).toEqual({ error: "parse", line: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findBlock
// ─────────────────────────────────────────────────────────────────────────────

describe("findBlock", () => {
  it("returns no-key when no block has the key or name", () => {
    const file = parsed(UI);
    expect(findBlock(file, { kind: "text", key: "ui.nope" })).toEqual({
      error: "no-key",
      key: "ui.nope"
    });
    expect(findBlock(file, { kind: "const", name: "ui.number" })).toEqual({
      error: "no-key",
      key: "ui.number"
    });
  });

  it("returns ambiguous with the line of the second block", () => {
    const text = [
      '  "ui.x": { size: 1 },',
      '  "ui.y": { size: 2 },',
      '  "ui.x": { size: 3 },'
    ].join("\n");
    expect(findBlock(parsed(text), { kind: "text", key: "ui.x" })).toEqual({
      error: "ambiguous",
      key: "ui.x",
      line: 3
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fieldRule, stepValue, formatNumber
// ─────────────────────────────────────────────────────────────────────────────

describe("fieldRule", () => {
  const text = { kind: "text", key: "ui.number" } as const;
  const layout = { kind: "const", name: "hudRow" } as const;

  it("gives the text-style bounds", () => {
    expect(fieldRule(text, "size")).toEqual({
      min: 1,
      max: 512,
      step: 1,
      bigStep: 10,
      integer: false
    });
    expect(fieldRule(text, "strokeWidth")).toMatchObject({ min: 0, max: 64, bigStep: 5 });
    expect(fieldRule(text, "letterSpacing")).toMatchObject({ min: -50, max: 50, step: 0.5 });
    expect(fieldRule(text, "wrap")).toMatchObject({ min: 0, max: 4096 });
    expect(fieldRule(text, "shadow.dx")).toMatchObject({ min: -256, max: 256 });
    expect(fieldRule(text, "shadow.dy")).toMatchObject({ min: -256, max: 256 });
    expect(fieldRule(text, "shadow.alpha")).toMatchObject({ min: 0, max: 1, step: 0.05 });
  });

  it("gives the layout bounds", () => {
    for (const path of ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"]) {
      expect(fieldRule(layout, path)).toMatchObject({ min: 0, max: 8192 });
    }
    expect(fieldRule(layout, "gap")).toMatchObject({ min: 0, max: 1024 });
    for (const side of ["", ".top", ".right", ".bottom", ".left"]) {
      expect(fieldRule(layout, `padding${side}`)).toMatchObject({ min: 0, max: 1024 });
      expect(fieldRule(layout, `margin${side}`)).toMatchObject({ min: -1024, max: 1024 });
    }
    for (const side of ["left", "top", "right", "bottom"]) {
      expect(fieldRule(layout, side)).toMatchObject({ min: -4096, max: 4096 });
    }
    expect(fieldRule(layout, "grow")).toMatchObject({ min: 0, max: 64, bigStep: 1 });
    expect(fieldRule(layout, "shrink")).toMatchObject({ min: 0, max: 64, bigStep: 1 });
    expect(fieldRule(layout, "aspect")).toMatchObject({ min: 0.05, max: 20, bigStep: 0.5 });
    expect(fieldRule(layout, "alpha")).toMatchObject({ min: 0, max: 1, step: 0.05 });
    expect(fieldRule(layout, "zIndex")).toEqual({
      min: -1000,
      max: 1000,
      step: 1,
      bigStep: 10,
      integer: true
    });
  });

  it("gives no rule for a path of the other block kind or an unknown path", () => {
    expect(fieldRule(text, "width")).toBeUndefined();
    expect(fieldRule(layout, "size")).toBeUndefined();
    expect(fieldRule(text, "lineHeight")).toBeUndefined();
    expect(fieldRule(layout, "toString")).toBeUndefined();
  });
});

describe("stepValue", () => {
  const alpha = { min: 0, max: 1, step: 0.05, bigStep: 0.1, integer: false };
  const size = { min: 1, max: 512, step: 1, bigStep: 10, integer: false };
  const zIndex = { min: -1000, max: 1000, step: 1, bigStep: 10, integer: true };

  it("adds one step without float drift", () => {
    expect(stepValue(alpha, 0.55, 1, false)).toBe(0.6);
    expect(stepValue(alpha, 0.3, -1, false)).toBe(0.25);
  });

  it("adds the big step with Shift", () => {
    expect(stepValue(size, 60, 1, true)).toBe(70);
    expect(stepValue(alpha, 0.55, -1, true)).toBe(0.45);
  });

  it("clamps to the bounds", () => {
    expect(stepValue(size, 508, 1, true)).toBe(512);
    expect(stepValue(size, 3, -1, true)).toBe(1);
    expect(stepValue(alpha, 0.98, 1, false)).toBe(1);
  });

  it("rounds to an integer when the rule says so", () => {
    expect(stepValue(zIndex, 1.5, 1, false)).toBe(3);
    expect(stepValue(zIndex, 4, -1, true)).toBe(-6);
  });
});

describe("formatNumber", () => {
  it("prints integers without decimals", () => {
    expect(formatNumber(60)).toBe("60");
    expect(formatNumber(-4)).toBe("-4");
    expect(formatNumber(-0)).toBe("0");
  });

  it("prints at most two decimals with trailing zeros trimmed", () => {
    expect(formatNumber(0.5)).toBe("0.5");
    expect(formatNumber(0.55)).toBe("0.55");
    expect(formatNumber(1.25)).toBe("1.25");
    expect(formatNumber(0.333)).toBe("0.33");
    expect(formatNumber(-1.5)).toBe("-1.5");
    expect(formatNumber(0.999)).toBe("1");
    expect(formatNumber(-0.001)).toBe("0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// editNumber
// ─────────────────────────────────────────────────────────────────────────────

describe("editNumber", () => {
  it("changes exactly one numeric literal and nothing else", () => {
    const done = editNumber(UI, NUMBER_SIZE, 64);
    if (isStyleEditError(done)) throw new Error(done.error);

    const before = lines(UI);
    const after = lines(done.text);
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [index + 1]));

    expect(done.line).toBe(74);
    expect(changed).toEqual([74]);
    expect(after[73]).toBe("    size: 64,");
    expect(done.text).toHaveLength(UI.length);
  });

  it("edits a literal in the middle of a one-line block", () => {
    const target = { ref: { kind: "text", key: "ui.tab" }, path: "size", raw: "50" } as const;
    const done = editNumber(UI, target, 48.5);
    if (isStyleEditError(done)) throw new Error(done.error);
    expect(lines(done.text)[91]).toBe(
      '  "ui.tab": { font: "ui.font-display", size: 48.5, fill: ink, align: "center" },'
    );
  });

  it("edits a nested literal of a layout style", () => {
    const target = {
      ref: { kind: "const", name: "hudRow" },
      path: "padding.right",
      raw: "40"
    } as const;
    const done = editNumber(HUD, target, -0);
    if (isStyleEditError(done)) throw new Error(done.error);
    expect(lines(done.text)[21]).toBe("  padding: { left: 40, right: 0 }");
  });

  it("keeps CRLF line ends", () => {
    const text = UI.replaceAll("\n", "\r\n");
    const done = editNumber(text, NUMBER_SIZE, 61);
    if (isStyleEditError(done)) throw new Error(done.error);

    const before = text.split("\r\n");
    const after = done.text.split("\r\n");
    expect(after).toHaveLength(before.length);
    expect(after[73]).toBe("    size: 61,");
    expect([...after.slice(0, 73), ...after.slice(74)]).toEqual([
      ...before.slice(0, 73),
      ...before.slice(74)
    ]);
  });

  it("returns the parse error of an unreadable file", () => {
    expect(editNumber("const a = defineStyle({", NUMBER_SIZE, 64)).toEqual({
      error: "parse",
      line: 1
    });
  });

  it("returns no-key and ambiguous blocks", () => {
    expect(editNumber(HUD, NUMBER_SIZE, 64)).toEqual({ error: "no-key", key: "ui.number" });
    const twice = '"ui.number": { size: 60 },\n"ui.number": { size: 60 },';
    expect(editNumber(twice, NUMBER_SIZE, 64)).toMatchObject({ error: "ambiguous", line: 2 });
  });

  it("returns changed-on-disk when the field is gone", () => {
    const target = { ...NUMBER_SIZE, path: "letterSpacing" };
    expect(editNumber(UI, target, 1)).toMatchObject({
      error: "changed-on-disk",
      path: "letterSpacing"
    });
  });

  it("returns ambiguous for a field written twice", () => {
    const text = '"ui.number": { size: 60, size: 60 },';
    expect(editNumber(text, NUMBER_SIZE, 64)).toMatchObject({
      error: "ambiguous",
      key: "ui.number",
      path: "size"
    });
  });

  it("returns not-literal for an expression", () => {
    const text = '"ui.number": {\n  size: BIG * 2\n},';
    expect(editNumber(text, { ...NUMBER_SIZE, raw: "BIG * 2" }, 64)).toEqual({
      error: "not-literal",
      key: "ui.number",
      path: "size",
      line: 2
    });
  });

  it("returns changed-on-disk when the literal differs from what the card showed", () => {
    expect(editNumber(UI, { ...NUMBER_SIZE, raw: "58" }, 64)).toEqual({
      error: "changed-on-disk",
      key: "ui.number",
      path: "size",
      line: 74
    });
  });

  it("returns read-only for a number without a rule", () => {
    const text = '"ui.number": { lineHeight: 1.2 },';
    const target = { ...NUMBER_SIZE, path: "lineHeight", raw: "1.2" };
    expect(editNumber(text, target, 1.3)).toMatchObject({ error: "read-only", path: "lineHeight" });
  });

  it("returns out-of-range outside the bounds or for a non-finite value", () => {
    for (const next of [0, 513, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(editNumber(UI, NUMBER_SIZE, next)).toMatchObject({
        error: "out-of-range",
        path: "size"
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadStyleFile, writeNumber
// ─────────────────────────────────────────────────────────────────────────────

describe("loadStyleFile", () => {
  it("reads and parses the file", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const loaded = await loadStyleFile(fake.files, UI_PATH);
    if (isStyleEditError(loaded)) throw new Error(loaded.error);

    expect(loaded.text).toBe(UI);
    expect(loaded.version).toBe("v1");
    expect(loaded.file.blocks).toHaveLength(17);
  });

  it("returns no-file for a missing or forbidden file", async () => {
    const fake = fakeFiles({});
    expect(await loadStyleFile(fake.files, "gone.ts")).toEqual({
      error: "no-file",
      path: "gone.ts"
    });
    fake.readFailures.push(wireError(-32_004, "forbidden path: ../x.ts"));
    expect(await loadStyleFile(fake.files, "../x.ts")).toEqual({
      error: "no-file",
      path: "../x.ts"
    });
  });

  it("lets other rejections propagate", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const boom = wireError(-32_003, "no session");
    fake.readFailures.push(boom);
    await expect(loadStyleFile(fake.files, UI_PATH)).rejects.toBe(boom);
    fake.readFailures.push(new Error("socket closed"));
    await expect(loadStyleFile(fake.files, UI_PATH)).rejects.toThrow("socket closed");
  });

  it("returns the parse error of an unreadable file", async () => {
    const fake = fakeFiles({ "bad.ts": "}" });
    expect(await loadStyleFile(fake.files, "bad.ts")).toEqual({ error: "parse", line: 1 });
  });
});

describe("writeNumber", () => {
  const current: FileText = { text: UI, version: "v1" };

  it("writes the edited text with the read version", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const done = await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64);

    expect(done).toEqual({
      ok: true,
      text: fake.texts.get(UI_PATH),
      line: 74,
      version: "v2",
      bytes: UI.length
    });
    expect(fake.files.write).toHaveBeenCalledTimes(1);
    expect(fake.files.write).toHaveBeenCalledWith(
      UI_PATH,
      expect.stringContaining("size: 64,"),
      "v1"
    );
  });

  it("writes nothing when the edit is refused", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    expect(await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 999)).toMatchObject({
      error: "out-of-range"
    });
    expect(fake.files.write).not.toHaveBeenCalled();
  });

  it("retries once with the fresh version when the literal is unchanged on disk", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    fake.touch(UI_PATH, UI.replace("size: 100,", "size: 101,"));

    const done = await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64);

    expect(done).toMatchObject({ ok: true, line: 74, version: "v3" });
    expect(fake.files.write).toHaveBeenCalledTimes(2);
    const expected = lines(UI.replace("size: 100,", "size: 101,"));
    expected[73] = "    size: 64,";
    expect(fake.files.write).toHaveBeenLastCalledWith(UI_PATH, expected.join("\n"), "v2");
  });

  it("returns changed-on-disk and writes nothing when the literal changed on disk", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const changed = UI.replace(
      '"ui.number": {\n    font: "ui.font-display",\n    size: 60,',
      '"ui.number": {\n    font: "ui.font-display",\n    size: 62,'
    );
    fake.touch(UI_PATH, changed);

    expect(await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).toEqual({
      error: "changed-on-disk"
    });
    expect(fake.files.write).toHaveBeenCalledTimes(1);
    expect(fake.texts.get(UI_PATH)).toBe(changed);
  });

  it("returns changed-on-disk when the second write conflicts again", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    fake.writeFailures.push(wireError(-32_005, "conflict"), wireError(-32_005, "conflict"));

    expect(await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).toEqual({
      error: "changed-on-disk"
    });
    expect(fake.files.write).toHaveBeenCalledTimes(2);
    expect(fake.files.read).toHaveBeenCalledTimes(1);
    expect(fake.texts.get(UI_PATH)).toBe(UI);
  });

  it("returns no-file when the file was deleted since the read", async () => {
    const fake = fakeFiles({});
    fake.writeFailures.push(wireError(-32_005, "conflict"));
    expect(await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).toEqual({
      error: "no-file",
      path: UI_PATH
    });
  });

  it("lets a rejection of the fresh read propagate when it is not a missing file", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const boom = wireError(-32_003, "no session");
    fake.writeFailures.push(wireError(-32_005, "conflict"));
    fake.readFailures.push(boom);
    await expect(writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).rejects.toBe(boom);
  });

  it("returns no-file for a forbidden path, on the first and on the second write", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    fake.writeFailures.push(wireError(-32_004, "forbidden"));
    expect(await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).toEqual({
      error: "no-file",
      path: UI_PATH
    });
    fake.writeFailures.push(wireError(-32_005, "conflict"), wireError(-32_004, "forbidden"));
    expect(await writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).toEqual({
      error: "no-file",
      path: UI_PATH
    });
  });

  it("lets any other write rejection propagate", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const boom = new Error("socket closed");
    fake.writeFailures.push(boom);
    await expect(writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).rejects.toBe(boom);
    const again = wireError(-32_002, "timeout");
    fake.writeFailures.push(wireError(-32_005, "conflict"), again);
    await expect(writeNumber(fake.files, UI_PATH, current, NUMBER_SIZE, 64)).rejects.toBe(again);
  });
});

/**
 * One answer of `find` for the edited block.
 *
 * @param path - The file of the answer.
 * @param broken - Whether the last good parse answered.
 * @returns The Found.
 */
function found(path: string, broken: boolean): ProjectFound {
  const answer: ProjectFound = { path, line: 72, range: [72, 3, 80, 4], hash: "v1" };
  return broken ? { ...answer, broken: true } : answer;
}

describe("writeNumber broken guard (D-44)", () => {
  const current: FileText = { text: UI, version: "v1" };
  const NUMBER_KEY = "textStyle:ui.number";

  it("writes nothing and returns broken when the index says the file does not parse now", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const find = vi.fn(async () => [found(UI_PATH, true)]);

    expect(await writeNumber({ ...fake.files, find }, UI_PATH, current, NUMBER_SIZE, 64)).toEqual({
      error: "broken",
      path: UI_PATH
    });
    expect(find).toHaveBeenCalledWith(NUMBER_KEY);
    expect(fake.files.write).not.toHaveBeenCalled();
    expect(fake.texts.get(UI_PATH)).toBe(UI);
  });

  it("asks the style: key of a defineStyle const", async () => {
    const fake = fakeFiles({ "features/hud/styles.ts": HUD });
    const find = vi.fn(async () => [found("features/hud/styles.ts", true)]);
    const target: EditTarget = {
      ref: { kind: "const", name: "hudRow" },
      path: "padding.left",
      raw: "40"
    };

    const done = await writeNumber(
      { ...fake.files, find },
      "features/hud/styles.ts",
      { text: HUD, version: "v1" },
      target,
      41
    );

    expect(done).toEqual({ error: "broken", path: "features/hud/styles.ts" });
    expect(find).toHaveBeenCalledWith("style:features/hud/styles.ts#hudRow");
  });

  it("writes when the index answers the file whole, or a broken file elsewhere", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const find = vi.fn(async () => [found(UI_PATH, false), found("other/styles.ts", true)]);

    expect(
      await writeNumber({ ...fake.files, find }, UI_PATH, current, NUMBER_SIZE, 64)
    ).toMatchObject({ ok: true, line: 74 });
    expect(fake.files.write).toHaveBeenCalledTimes(1);
  });

  it("writes when find rejects: the guard never blocks on a lost link", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    const find = vi.fn(async (): Promise<readonly ProjectFound[]> => {
      throw wireError(-32_002, "timeout");
    });

    expect(
      await writeNumber({ ...fake.files, find }, UI_PATH, current, NUMBER_SIZE, 64)
    ).toMatchObject({ ok: true });
  });

  it("checks again before the retry: a file broken since the conflict is not written", async () => {
    const fake = fakeFiles({ [UI_PATH]: UI });
    fake.touch(UI_PATH, UI.replace("size: 100,", "size: 101,"));
    const find = vi
      .fn<(key: string) => Promise<readonly ProjectFound[]>>()
      .mockResolvedValueOnce([found(UI_PATH, false)])
      .mockResolvedValueOnce([found(UI_PATH, true)]);

    expect(await writeNumber({ ...fake.files, find }, UI_PATH, current, NUMBER_SIZE, 64)).toEqual({
      error: "broken",
      path: UI_PATH
    });
    expect(find).toHaveBeenCalledTimes(2);
    expect(fake.files.write).toHaveBeenCalledTimes(1);
    expect(fake.files.read).not.toHaveBeenCalled();
  });

  it("has one shared text for the views", () => {
    expect(STYLE_BROKEN_TEXT).toBe("The file does not parse now · fix it, then edit");
  });
});

describe("isStyleEditError", () => {
  it("is true for every edit error code", () => {
    const codes: StyleEditError["error"][] = [
      "broken",
      "no-file",
      "parse",
      "no-key",
      "ambiguous",
      "not-literal",
      "read-only",
      "changed-on-disk",
      "out-of-range"
    ];
    for (const error of codes) expect(isStyleEditError({ error })).toBe(true);
  });

  it("is false for anything else", () => {
    for (const value of [undefined, "parse", 1, [], { error: "nope" }, { ok: true }, parsed(HUD)]) {
      expect(isStyleEditError(value)).toBe(false);
    }
  });
});
