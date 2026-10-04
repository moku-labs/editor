import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MERGE_GAME_DIR } from "../../../../../tests/fixtures/game-dir";
import { entryDirOf, findStyleSource, importCandidates, matchKey } from "../../element/source";
import { CONFIG, createCtx, manifestOf } from "../helpers";

/** The Signboard of merge-game's settings popup (features/settings/settings.tsx:299-308). */
const SETTINGS = [
  "  view: (props: SettingsProps, local) => (",
  '    <PopupScreen id="settings" dismiss="close">',
  "      <Signboard",
  '        id="settingsBoard"',
  '        title={tr("settings.title")}',
  "        width={950}",
  "        height={1060}",
  "        top={settingsTop}",
  "        hung",
  '        close="close"',
  "      >",
  '        <Parchment id="settingsPane">'
].join("\n");

/** merge-game's Signboard component (features/ui/kit.tsx:809-813): the key is not a literal. */
const KIT = [
  "  return (",
  "    <panel",
  "      key={props.id}",
  "      style={boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)}",
  "      {...(hung ? { motion: swingMotion } : {})}",
  "    >"
].join("\n");

describe("matchKey", () => {
  it('finds key="k" and the style ident on that line', () => {
    expect(matchKey('a\n<Row key="hudRow" style={hudRow}>\n', "hudRow")).toEqual({
      line: 2,
      style: { kind: "ident", name: "hudRow", line: 2 }
    });
  });

  it('finds key={"k"} and style={ ident } with spaces', () => {
    expect(matchKey('<Pill key={"coinPill"} style={ coinPill } />', "coinPill")).toEqual({
      line: 1,
      style: { kind: "ident", name: "coinPill", line: 1 }
    });
  });

  it('finds key: "k"', () => {
    expect(
      matchKey('<Button {...{ key: "settings" }} style={settingsStyle} />', "settings")
    ).toEqual({ line: 1, style: { kind: "ident", name: "settingsStyle", line: 1 } });
  });

  it('finds the id forms: id="k", id={"k"} and id: "k"', () => {
    expect(matchKey('<Signboard id="board" style={board} />', "board")?.line).toBe(1);
    expect(matchKey('<Signboard id={"board"} />', "board")).toEqual({ line: 1, style: undefined });
    expect(matchKey('const props = { id: "board" };', "board")).toEqual({
      line: 1,
      style: undefined
    });
    expect(matchKey('<a data-id="board" />', "board")).toBeUndefined();
  });

  it("gives the line without a style when the element has none", () => {
    expect(matchKey('<Box key="energyPill" />', "energyPill")).toEqual({
      line: 1,
      style: undefined
    });
  });

  it("searches the style to the end of the JSX element, over several lines", () => {
    const text = '<Row\n  key="hudRow"\n  gap={4}\n  onTap={() => go()}\n  style={hudRow}\n>';
    expect(matchKey(text, "hudRow")).toEqual({
      line: 2,
      style: { kind: "ident", name: "hudRow", line: 5 }
    });
  });

  it("stops at the line that closes the element, and after eight lines", () => {
    expect(matchKey('<Box key="a" />\n<Other style={other} />', "a")).toEqual({
      line: 1,
      style: undefined
    });
    const long = ['<Row key="a"', ...Array.from({ length: 7 }, () => "  x={1}"), "  style={late}"];
    expect(matchKey(long.join("\n"), "a")?.style).toBeUndefined();
  });

  it("reads style={call(...)} as a call with its line", () => {
    expect(matchKey(KIT.replace("key={props.id}", 'key="settingsBoard"'), "settingsBoard")).toEqual(
      {
        line: 3,
        style: {
          kind: "call",
          text: "boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)",
          line: 4
        }
      }
    );
    expect(matchKey('<A key="a" style={styles.row(\n  1\n)} />', "a")?.style).toEqual({
      kind: "call",
      text: "styles.row(…",
      line: 1
    });
  });

  it("prefers a later key line with a style over an earlier one without", () => {
    expect(matchKey('<A key="k" />\n<B key="k" style={b} />', "k")).toEqual({
      line: 2,
      style: { kind: "ident", name: "b", line: 2 }
    });
  });

  it("matches the key literally (dots are not wildcards) and not as a prefix", () => {
    expect(matchKey('<Text key="uiXnumber" style={a} />', "ui.number")).toBeUndefined();
    expect(matchKey('<Text key="coinPillIcon" style={a} />', "coinPill")).toBeUndefined();
  });

  it("finds settingsBoard in merge-game's settings popup with no style of its own", () => {
    expect(matchKey(SETTINGS, "settingsBoard")).toEqual({ line: 4, style: undefined });
    expect(matchKey(KIT, "settingsBoard")).toBeUndefined();
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

describe("entryDirOf", () => {
  it("is the folder of the game page entry, empty at the root or without a page", () => {
    expect(entryDirOf("http://127.0.0.1:3000/web/editor.html")).toBe("web");
    expect(entryDirOf("http://127.0.0.1:3000/tests/game%20one/")).toBe("tests/game one");
    expect(entryDirOf("http://127.0.0.1:3000/game.html")).toBe("");
    expect(entryDirOf("/web/index.html")).toBe("web");
    expect(entryDirOf("http://127.0.0.1:3000/%E0%A4%A/x.html")).toBe("");
    expect(entryDirOf(undefined)).toBe("");
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
      kind: "ident",
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
    expect(ctx.state.found.get("coinPill")?.path).toBe("src/hud/Hud.tsx");
  });

  it("finds a root file before a nested one", async () => {
    const ctx = createCtx({
      "src/deep.tsx": '<A key="hudRow" style={deep} />',
      "root.tsx": '<A key="hudRow" style={root} />'
    });
    const found = await findStyleSource(ctx, "hudRow");
    expect(found?.path).toBe("root.tsx");
  });

  it("goes on to the next file when the element has no style", async () => {
    const ctx = createCtx({
      "a.tsx": '<Box key="energyPill" />',
      "b.tsx": '<Box key="energyPill" style={energy} />'
    });
    const found = await findStyleSource(ctx, "energyPill");
    expect(found?.kind === "ident" ? found.ref : undefined).toEqual({
      kind: "const",
      name: "energy"
    });
  });

  it("returns a style call with the line of the call", async () => {
    const ctx = createCtx({ "kit.tsx": KIT.replace("key={props.id}", 'key="settingsBoard"') });
    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      kind: "call",
      path: "kit.tsx",
      line: 3,
      call: "boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)",
      callLine: 4
    });
  });

  it("falls back to where the key is defined when no file has a style for it", async () => {
    const ctx = createCtx({
      "features/settings/settings.tsx": SETTINGS,
      "features/ui/kit.tsx": KIT
    });
    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      kind: "defined",
      path: "features/settings/settings.tsx",
      line: 4
    });
    expect(ctx.state.found.get("settingsBoard")?.kind).toBe("defined");
  });

  it("starts from the folder of the game page entry, then the root", async () => {
    const ctx = createCtx({
      "a.tsx": '<A key="hudRow" style={root} />',
      "web/game/b.tsx": '<A key="hudRow" style={entry} />'
    });
    ctx.link.manifestValue = { ...manifestOf(), page: "http://127.0.0.1:3000/web/game/index.html" };
    const list = vi.spyOn(ctx.link.files, "list");
    const found = await findStyleSource(ctx, "hudRow");
    expect(found?.path).toBe("web/game/b.tsx");
    expect(list.mock.calls.map(call => call[0])).toEqual(["web/game"]);
  });

  it("lists the entry folder once when the root search meets it again", async () => {
    const ctx = createCtx({ "web/a.tsx": "", "src/b.tsx": '<A key="hudRow" style={b} />' });
    ctx.link.manifestValue = { ...manifestOf(), page: "http://127.0.0.1:3000/web/index.html" };
    const list = vi.spyOn(ctx.link.files, "list");
    const found = await findStyleSource(ctx, "hudRow");
    expect(found?.path).toBe("src/b.tsx");
    expect(list.mock.calls.map(call => call[0])).toEqual(["web", "", "src"]);
  });

  it("skips the configured folders and every file that is not .ts or .tsx", async () => {
    const ctx = createCtx({
      "node_modules/pkg/x.tsx": '<A key="hudRow" style={a} />',
      "dist/x.tsx": '<A key="hudRow" style={a} />',
      ".moku/editor/x.ts": '<A key="hudRow" style={a} />',
      "src/readme.md": '<A key="hudRow" style={a} />'
    });
    const list = vi.spyOn(ctx.link.files, "list");
    expect(await findStyleSource(ctx, "hudRow")).toBeUndefined();
    expect(list.mock.calls.map(call => call[0])).toEqual(["", "src"]);
  });

  it("reads at most maxFiles files, 1500 by default", async () => {
    expect(CONFIG.sourceSearch.maxFiles).toBe(1500);
    const ctx = {
      ...createCtx({ "a.ts": "", "b.ts": "", "c.ts": '<A key="hudRow" style={a} />' }),
      config: { ...CONFIG, sourceSearch: { maxFiles: 2, skip: [] } }
    };
    const read = vi.spyOn(ctx.link.files, "read");
    expect(await findStyleSource(ctx, "hudRow")).toBeUndefined();
    expect(read.mock.calls.map(call => call[0])).toEqual(["a.ts", "b.ts"]);
  });

  it("is undefined when the root cannot be listed, and forgets an older result", async () => {
    const ctx = createCtx();
    ctx.state.found.set("hudRow", { kind: "defined", path: "gone.tsx", line: 1 });
    vi.spyOn(ctx.link.files, "list").mockRejectedValue(new Error("offline"));
    expect(await findStyleSource(ctx, "hudRow")).toBeUndefined();
    expect(ctx.state.found.has("hudRow")).toBe(false);
  });
});

describe.skipIf(!existsSync(MERGE_GAME_DIR))(
  "findStyleSource on the merge-game fixture files",
  () => {
    it("resolves settingsBoard to settings.tsx:301 (Defined at), never to the kit", async () => {
      const files: Record<string, string> = {};
      for (const file of ["features/settings/settings.tsx", "features/ui/kit.tsx"]) {
        files[file] = readFileSync(path.join(MERGE_GAME_DIR, file), "utf8");
      }
      const found = await findStyleSource(createCtx(files), "settingsBoard");
      expect(found).toEqual({ kind: "defined", path: "features/settings/settings.tsx", line: 301 });
    });
  }
);
