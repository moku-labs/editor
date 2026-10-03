import { describe, expect, it, vi } from "vitest";
import { findStyleSource, importCandidates, matchKey } from "../../element/source";
import { CONFIG, createCtx } from "../helpers";

describe("matchKey", () => {
  it('finds key="k" and the style ident on that line', () => {
    expect(matchKey('a\n<Row key="hudRow" style={hudRow}>\n', "hudRow")).toEqual({
      line: 2,
      ident: "hudRow"
    });
  });

  it('finds key={"k"} and style={ ident } with spaces', () => {
    expect(matchKey('<Pill key={"coinPill"} style={ coinPill } />', "coinPill")).toEqual({
      line: 1,
      ident: "coinPill"
    });
  });

  it('finds key: "k"', () => {
    expect(
      matchKey('<Button {...{ key: "settings" }} style={settingsStyle} />', "settings")
    ).toEqual({
      line: 1,
      ident: "settingsStyle"
    });
  });

  it("gives the line without an ident when the key line has no style", () => {
    expect(matchKey('<Box key="energyPill" />', "energyPill")).toEqual({
      line: 1,
      ident: undefined
    });
  });

  it("matches the key literally (dots are not wildcards) and not as a prefix", () => {
    expect(matchKey('<Text key="uiXnumber" style={a} />', "ui.number")).toBeUndefined();
    expect(matchKey('<Text key="coinPillIcon" style={a} />', "coinPill")).toBeUndefined();
  });
});

describe("importCandidates", () => {
  it("resolves the relative import of the ident to .ts, .tsx and index files", () => {
    const text = 'import { hudRow, coinPill as pill } from "./styles";\nimport x from "../kit";';
    expect(importCandidates(text, "pill", "src/hud/Hud.tsx")).toEqual([
      "src/hud/styles.ts",
      "src/hud/styles.tsx",
      "src/hud/styles/index.ts"
    ]);
    expect(importCandidates(text, "hudRow", "src/hud/Hud.tsx")[0]).toBe("src/hud/styles.ts");
    expect(
      importCandidates('import { a } from "../kit/styles.ts";', "a", "src/hud/Hud.tsx")
    ).toEqual(["src/kit/styles.ts"]);
  });

  it("is empty for a package import or an ident that is not imported", () => {
    expect(importCandidates('import { a } from "pkg";', "a", "src/Hud.tsx")).toEqual([]);
    expect(importCandidates("const a = 1;", "a", "src/Hud.tsx")).toEqual([]);
  });
});

describe("findStyleSource", () => {
  it("searches .ts/.tsx files breadth-first and returns the file, the const ref and the block files", async () => {
    const ctx = createCtx({
      "src/hud/Hud.tsx":
        'import { coinPill } from "./styles";\n<Pill key="coinPill" style={coinPill} />\n',
      "src/hud/styles.ts": "export const coinPill = defineStyle({ height: 76 });\n"
    });
    expect(await findStyleSource(ctx, "coinPill")).toEqual({
      path: "src/hud/Hud.tsx",
      line: 2,
      ref: { kind: "const", name: "coinPill" },
      files: [
        "src/hud/Hud.tsx",
        "src/hud/styles.ts",
        "src/hud/styles.tsx",
        "src/hud/styles/index.ts"
      ]
    });
  });

  it("finds a root file before a nested one", async () => {
    const ctx = createCtx({
      "src/deep.tsx": '<A key="hudRow" style={deep} />',
      "root.tsx": '<A key="hudRow" style={root} />'
    });
    const found = await findStyleSource(ctx, "hudRow");
    expect(found?.path).toBe("root.tsx");
  });

  it("goes on to the next file when the key line has no style", async () => {
    const ctx = createCtx({
      "a.tsx": '<Box key="energyPill" />',
      "b.tsx": '<Box key="energyPill" style={energy} />'
    });
    const found = await findStyleSource(ctx, "energyPill");
    expect(found?.ref).toEqual({
      kind: "const",
      name: "energy"
    });
  });

  it("skips the configured folders and every file that is not .ts or .tsx", async () => {
    const ctx = createCtx({
      "node_modules/pkg/x.tsx": '<A key="hudRow" style={a} />',
      "dist/x.tsx": '<A key="hudRow" style={a} />',
      ".moku/editor/x.ts": '<A key="hudRow" style={a} />',
      "src/notes.md": '<A key="hudRow" style={a} />'
    });
    const list = vi.spyOn(ctx.link.files, "list");
    expect(await findStyleSource(ctx, "hudRow")).toBeUndefined();
    expect(list.mock.calls.map(call => call[0])).toEqual(["", "src"]);
  });

  it("reads at most maxFiles files", async () => {
    const ctx = {
      ...createCtx({ "a.ts": "", "b.ts": "", "c.ts": '<A key="hudRow" style={a} />' }),
      config: { ...CONFIG, sourceSearch: { maxFiles: 2, skip: [] } }
    };
    const read = vi.spyOn(ctx.link.files, "read");
    expect(await findStyleSource(ctx, "hudRow")).toBeUndefined();
    expect(read.mock.calls.map(call => call[0])).toEqual(["a.ts", "b.ts"]);
  });

  it("is undefined when the root cannot be listed", async () => {
    const ctx = createCtx();
    vi.spyOn(ctx.link.files, "list").mockRejectedValue(new Error("offline"));
    expect(await findStyleSource(ctx, "hudRow")).toBeUndefined();
  });
});
