import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  callStyleKey,
  findStyleSource,
  importCandidates,
  styleFilesOf,
  styleInRange
} from "../../element/source";
import { answer, createCtx, place, projectOn, type TestCtx, templateOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The source of a picked element comes from the project index only (D-38,
// amendment N): the first answer of `jsx:<key>`, the style attribute of the tag
// that opens its range, and the files the index defines the style in. An id prop
// has its style on the element its component draws: the pattern its prop fills
// in the component of its name, taken from the same answer of the index.
// No crawl.
// ─────────────────────────────────────────────────────────────────────────────

/** merge-game's Signboard component (features/ui/kit.tsx:830-834): its style is a call. */
const KIT = [
  "  return (",
  "    <panel",
  "      key={props.id}",
  "      style={boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)}",
  "      {...(hung ? { motion: swingMotion } : {})}",
  "    >",
  "      {props.children as never}",
  "    </panel>"
];

/** The settings board as merge-game writes it, shortened (features/settings/settings.tsx:289). */
const SETTINGS = [
  "      <Signboard",
  '        id="settingsBoard"',
  '        title={tr("settings.title")}',
  "        width={950}",
  "        hung",
  '        close="close"',
  "      >",
  '        <Parchment id="settingsPane" style={pane} />',
  "      </Signboard>"
];

/** merge-game's daily gift, shortened (features/gift/popups/daily-gift.tsx:23): a prop names the number. */
const GIFT = [
  "        <Amount",
  '          id="giftAmount"',
  '          amountKey="giftReward"',
  "          amount={amount}",
  "        />"
];

/** merge-game's Amount component (shared/views/amount.tsx:33): the number is a text with a text style. */
const AMOUNT = [
  "    <row key={props.id} style={amountRow}>",
  '      <text key={props.amountKey} style="ui.amount" content={props.amount} />',
  "    </row>"
];

/** The answer of `jsx:giftReward` at the prop: the whole `<Amount … />`, the line of `amountKey=`. */
const GIFT_PROP = place("features/gift/popups/daily-gift.tsx", [1, 9, 5, 11], {
  line: 3,
  key: "giftReward",
  kind: "idProp",
  component: "Amount",
  prop: "amountKey"
});

/** The answer of `jsx:giftReward` in the component: the text its `{amountKey}` pattern keys. */
const AMOUNT_TEXT = place("shared/views/amount.tsx", [2, 7, 2, 78], {
  key: "{amountKey}",
  kind: "ident",
  component: "Amount"
});

/** The answer of `jsx:giftReward` without its style: the id prop is defined at its line. */
const GIFT_DEFINED = {
  kind: "defined",
  path: "features/gift/popups/daily-gift.tsx",
  line: 3,
  range: [1, 9, 5, 11]
};

/** The `{id}` pattern of a component named Board: the panel it draws. */
const BOARD_PANEL = { key: "{id}", kind: "ident", component: "Board" } as const;

/** The id prop of the settings board, on line 2 of its file. */
const BOARD_PROP = place("features/settings/settings.tsx", [2, 1, 2, 29], {
  key: "settingsBoard",
  kind: "idProp",
  component: "Board",
  prop: "id"
});

/**
 * A ctx with two files that each write a component named Board, and the settings file that
 * passes `id="settingsBoard"` to one of them. The index answers the shop's Board first.
 *
 * @param firstLine - Line 1 of the settings file: its import of Board, or the panel of a Board
 * written in the file itself.
 * @param uiBoard - The file of the ui Board: a file, or the index file of a folder.
 * @returns The ctx.
 */
function twoBoards(firstLine: string, uiBoard = "features/ui/board.tsx"): TestCtx {
  const ctx = createCtx({
    "features/settings/settings.tsx": [firstLine, '<Board id="settingsBoard" />'].join("\n"),
    "features/shop/board.tsx": "<panel key={props.id} style={shopBoard} />",
    [uiBoard]: "<panel key={props.id} style={uiBoard} />"
  });
  answer(
    ctx,
    "jsx:settingsBoard",
    BOARD_PROP,
    place("features/shop/board.tsx", [1, 1, 1, 43], BOARD_PANEL),
    place(uiBoard, [1, 1, 1, 41], BOARD_PANEL)
  );
  return ctx;
}

describe("styleInRange", () => {
  it("reads style={ident} on the tag that opens the range, with the line of the attribute", () => {
    expect(styleInRange(['<Row key="hudRow" style={hudRow}>', "</Row>"], [1, 1, 2, 7])).toEqual({
      kind: "ident",
      name: "hudRow",
      line: 1
    });
    expect(styleInRange(['<Pill key={"coinPill"} style={ coinPill } />'], [1, 1, 1, 44])).toEqual({
      kind: "ident",
      name: "coinPill",
      line: 1
    });
  });

  it("reads a tag over several lines, past arrows and spreads in other attributes", () => {
    const lines = [
      "  <Row",
      '    key="hudRow"',
      "    onTap={() => go(a > b)}",
      "    {...rest}",
      "    style={hudRow}",
      "  >"
    ];
    expect(styleInRange(lines, [1, 3, 6, 4])).toEqual({ kind: "ident", name: "hudRow", line: 5 });
  });

  it("never takes the style of a child: the element itself has none", () => {
    expect(styleInRange(SETTINGS, [1, 7, 9, 19])).toBeUndefined();
  });

  it("reads style={call(...)} as a call with the line of the attribute, one line long", () => {
    expect(styleInRange(KIT, [2, 5, 8, 13])).toEqual({
      kind: "call",
      text: "boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)",
      line: 4
    });
    expect(styleInRange(['<A key="a" style={styles.row(', "  1", ")} />"], [1, 1, 3, 6])).toEqual({
      kind: "call",
      text: "styles.row(…",
      line: 1
    });
  });

  it('reads style="ui.link" and style={"ui.tab"} as text style keys; not data-style', () => {
    expect(styleInRange(['<text key="r" style="ui.link" />'], [1, 1, 1, 33])).toEqual({
      kind: "text",
      key: "ui.link",
      line: 1
    });
    expect(styleInRange(["<text", '  key="r"', '  style={"ui.tab"}', "/>"], [1, 1, 4, 3])).toEqual({
      kind: "text",
      key: "ui.tab",
      line: 3
    });
    expect(styleInRange(['<a data-style="ui.link" key="k" />'], [1, 1, 1, 35])).toBeUndefined();
  });

  it("shows no style for an inline object, a condition, or a range that opens no tag", () => {
    expect(styleInRange(['<A key="a" style={{ gap: 4 }} />'], [1, 1, 1, 33])).toBeUndefined();
    expect(styleInRange(['<A key="a" style={on ? b : c} />'], [1, 1, 1, 33])).toBeUndefined();
    expect(
      styleInRange([`const key = ${templateOf("card", "slot")};`], [1, 1, 1, 27])
    ).toBeUndefined();
  });
});

describe("importCandidates", () => {
  it("resolves the relative import of the ident to .ts, .tsx and index files", () => {
    const text = 'import { hudRow, coinPill as pill } from "./styles";\nimport x from "../kit";';
    expect(importCandidates(text, "pill", "src/hud/Hud.tsx")).toEqual([
      "src/hud/styles.ts",
      "src/hud/styles.tsx",
      "src/hud/styles/index.ts",
      "src/hud/styles/index.tsx"
    ]);
    expect(importCandidates(text, "hudRow", "src/hud/Hud.tsx")[0]).toBe("src/hud/styles.ts");
    expect(
      importCandidates('import { a } from "../kit/styles.ts";', "a", "src/hud/Hud.tsx")
    ).toEqual(["src/kit/styles.ts"]);
  });

  it("offers the index.tsx of a folder: a component folder is imported by its name", () => {
    const text = 'import { Board } from "../ui/board";';
    expect(importCandidates(text, "Board", "features/settings/settings.tsx")).toContain(
      "features/ui/board/index.tsx"
    );
  });

  it("maps a specifier that names its extension to the source file, never to board.js.ts", () => {
    const from = "features/settings/settings.tsx";
    const candidates = (specifier: string) =>
      importCandidates(`import { Board } from "${specifier}";`, "Board", from);

    // NodeNext names the output: `.js` is written as `.ts` or `.tsx`, `.jsx` as `.tsx`.
    expect(candidates("../ui/board.js")).toEqual(["features/ui/board.ts", "features/ui/board.tsx"]);
    expect(candidates("../ui/board.jsx")).toEqual(["features/ui/board.tsx"]);
    expect(candidates("../ui/board/index.js")).toEqual([
      "features/ui/board/index.ts",
      "features/ui/board/index.tsx"
    ]);

    // A source extension is the file itself.
    expect(candidates("../ui/board.ts")).toEqual(["features/ui/board.ts"]);
    expect(candidates("../ui/board.tsx")).toEqual(["features/ui/board.tsx"]);

    // A dot that is no extension stays in the name.
    expect(candidates("../ui/board.styles")[0]).toBe("features/ui/board.styles.ts");
  });

  it("matches an inline `type` import by its name", () => {
    const from = "src/hud/Hud.tsx";
    expect(importCandidates('import { type Board } from "./board";', "Board", from)[0]).toBe(
      "src/hud/board.ts"
    );
    const mixed = 'import {\n  hudRow,\n  type Board,\n  type Pill as Chip\n} from "./kit";';
    expect(importCandidates(mixed, "Board", from)[0]).toBe("src/hud/kit.ts");
    expect(importCandidates(mixed, "Chip", from)[0]).toBe("src/hud/kit.ts");
    expect(importCandidates(mixed, "hudRow", from)[0]).toBe("src/hud/kit.ts");

    // `type` is the modifier, not a name of the list.
    expect(importCandidates(mixed, "type", from)).toEqual([]);
    expect(importCandidates(mixed, "type Board", from)).toEqual([]);
  });

  it("matches `Name as Alias` by the alias: the name the file writes", () => {
    const text = 'import { Board as Panel } from "./board";';
    expect(importCandidates(text, "Panel", "src/hud/Hud.tsx")[0]).toBe("src/hud/board.ts");
    expect(importCandidates(text, "Board", "src/hud/Hud.tsx")).toEqual([]);
  });

  it("matches a default import, alone, as a type, or before a named list", () => {
    const from = "src/hud/Hud.tsx";
    expect(importCandidates('import Board from "./board";', "Board", from)[0]).toBe(
      "src/hud/board.ts"
    );
    expect(importCandidates('import type Board from "./board";', "Board", from)[0]).toBe(
      "src/hud/board.ts"
    );

    const both = 'import Board, { type Pill, hudRow as row } from "./kit";';
    expect(importCandidates(both, "Board", from)[0]).toBe("src/hud/kit.ts");
    expect(importCandidates(both, "Pill", from)[0]).toBe("src/hud/kit.ts");
    expect(importCandidates(both, "row", from)[0]).toBe("src/hud/kit.ts");

    // A namespace import and a package are not followed.
    expect(importCandidates('import * as Board from "./board";', "Board", from)).toEqual([]);
    expect(importCandidates('import Board from "pkg";', "Board", from)).toEqual([]);
  });

  it("is empty for a package import or an ident that is not imported", () => {
    expect(importCandidates('import { a } from "pkg";', "a", "src/Hud.tsx")).toEqual([]);
    expect(importCandidates("const a = 1;", "a", "src/Hud.tsx")).toEqual([]);
  });
});

describe("styleFilesOf", () => {
  const HUD = { path: "src/hud/Hud.tsx", text: 'import { coinPill } from "./styles";' };

  it("lists the files the index defines the style in: own file, then the import, then the rest", () => {
    const project = projectOn({
      "style:a/other.ts#coinPill": ["a/other.ts"],
      "style:src/hud/styles.ts#coinPill": ["src/hud/styles.ts"],
      "style:src/hud/Hud.tsx#coinPill": ["src/hud/Hud.tsx"],
      "style:src/hud/styles.ts#coinPillIcon": ["src/hud/styles.ts"],
      "textStyle:coinPill": ["features/ui/styles.ts"]
    });
    expect(styleFilesOf(project, HUD, "coinPill", "coinPill")).toEqual([
      "src/hud/Hud.tsx",
      "src/hud/styles.ts",
      "a/other.ts"
    ]);
  });

  it("finds a style imported through a tsconfig alias: the index key names the file it resolved", () => {
    const board = {
      path: "features/board/views/board.tsx",
      text: 'import { coinPill } from "@shared";'
    };
    const project = projectOn({
      "style:shared/styles/text.ts#coinPill": ["shared/styles/text.ts"]
    });
    expect(styleFilesOf(project, board, "coinPill", "coinPill")).toEqual(["shared/styles/text.ts"]);
  });

  it("is empty when the index is off, has no state yet, or defines no such style", () => {
    expect(styleFilesOf({ state: "off", reason: "disabled" }, HUD, "coinPill", "coinPill")).toEqual(
      []
    );
    expect(styleFilesOf(undefined, HUD, "coinPill", "coinPill")).toEqual([]);
    expect(styleFilesOf(projectOn(), HUD, "coinPill", "coinPill")).toEqual([]);
  });
});

describe("callStyleKey (G2)", () => {
  const KIT_FILE = { path: "features/ui/kit.tsx", text: "" };

  it("names the style of function(…).property, else of the function, in the nearest file", () => {
    const project = projectOn({
      "style:features/ui/kit.tsx#roundStylesOf.icon": ["features/ui/kit.tsx"],
      "style:features/ui/kit.tsx#boardStyle": ["features/ui/kit.tsx"]
    });
    expect(callStyleKey(project, KIT_FILE, "roundStylesOf(size).icon")).toBe(
      "style:features/ui/kit.tsx#roundStylesOf.icon"
    );
    expect(callStyleKey(project, KIT_FILE, "boardStyle(950, 1060, top, true)")).toBe(
      "style:features/ui/kit.tsx#boardStyle"
    );
    expect(callStyleKey(project, KIT_FILE, "boardStyle(950).frame")).toBe(
      "style:features/ui/kit.tsx#boardStyle"
    );
  });

  it("has none for a member call, a wrapper the index does not know, or an index that is off", () => {
    const project = projectOn({ "style:features/ui/kit.tsx#boardStyle": ["features/ui/kit.tsx"] });
    expect(callStyleKey(project, KIT_FILE, "styles.row(1)")).toBeUndefined();
    expect(callStyleKey(project, KIT_FILE, "boardOf(950, 1060)")).toBeUndefined();
    expect(callStyleKey(undefined, KIT_FILE, "boardStyle(950)")).toBeUndefined();
  });
});

describe("findStyleSource", () => {
  const HUD = 'import { coinPill } from "./styles";\n<Pill key="coinPill" style={coinPill} />\n';

  it("asks jsx:<key> and returns the first answer, its range and the style files of the index", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": HUD });
    ctx.link.projectValue = projectOn({
      "style:src/hud/styles.ts#coinPill": ["src/hud/styles.ts"]
    });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
    const find = vi.spyOn(ctx.link.files, "find");

    const source = await findStyleSource(ctx, "coinPill");

    expect(find).toHaveBeenCalledWith("jsx:coinPill");
    expect(source).toEqual({
      kind: "ident",
      path: "src/hud/Hud.tsx",
      line: 2,
      range: [2, 1, 2, 42],
      ref: { kind: "const", name: "coinPill" },
      files: ["src/hud/styles.ts"]
    });
    expect(ctx.state.found.get("coinPill")).toBe(source);
  });

  it("keeps the key file alone when the index defines no such style (the edit then says no-key)", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": HUD });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
    const source = await findStyleSource(ctx, "coinPill");
    expect(source?.kind === "ident" ? source.files : []).toEqual(["src/hud/Hud.tsx"]);
  });

  it("keeps the line of an id prop and takes the style of the element its component draws (giftReward)", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": AMOUNT.join("\n")
    });
    answer(ctx, "jsx:giftReward", GIFT_PROP, AMOUNT_TEXT);

    const source = await findStyleSource(ctx, "giftReward");

    expect(source).toEqual({
      ...GIFT_DEFINED,
      textStyle: "ui.amount",
      stylePath: AMOUNT_TEXT.path
    });
    expect(ctx.state.found.get("giftReward")).toBe(source);
  });

  it("asks the index once for an id prop: the answers of its component come with the first one", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": AMOUNT.join("\n")
    });
    answer(ctx, "jsx:giftReward", GIFT_PROP, AMOUNT_TEXT);
    const find = vi.spyOn(ctx.link.files, "find");

    const source = await findStyleSource(ctx, "giftReward");

    expect(source).toMatchObject({ textStyle: "ui.amount", stylePath: AMOUNT_TEXT.path });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith("jsx:giftReward");
  });

  it("keeps the id prop line and takes the style call of the component it is passed to (Signboard), with the file of the call", async () => {
    const ctx = createCtx({
      "features/settings/settings.tsx": SETTINGS.join("\n"),
      "features/ui/kit.tsx": KIT.join("\n")
    });
    ctx.link.projectValue = projectOn({
      "style:features/ui/kit.tsx#boardOf": ["features/ui/kit.tsx"]
    });
    answer(
      ctx,
      "jsx:settingsBoard",
      place("features/settings/settings.tsx", [1, 7, 9, 19], {
        line: 2,
        key: "settingsBoard",
        kind: "idProp",
        component: "Signboard",
        prop: "id"
      }),
      place("features/ui/kit.tsx", [2, 5, 8, 13], {
        line: 3,
        key: "{id}",
        kind: "ident",
        component: "Signboard"
      })
    );
    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      kind: "call",
      path: "features/settings/settings.tsx",
      line: 2,
      range: [1, 7, 9, 19],
      call: "boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)",
      callLine: 4,
      styleKey: "style:features/ui/kit.tsx#boardOf",
      stylePath: "features/ui/kit.tsx"
    });
  });

  it("looks a component's style ident up from the component file, not from the id prop file", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": ['import { amountRow } from "./styles";', ...AMOUNT].join("\n")
    });
    ctx.link.projectValue = projectOn({
      "style:shared/views/styles.ts#amountRow": ["shared/views/styles.ts"]
    });
    answer(
      ctx,
      "jsx:giftAmount",
      { ...GIFT_PROP, line: 2, key: "giftAmount", prop: "id" },
      place("shared/views/amount.tsx", [2, 5, 4, 11], {
        key: "{id}",
        kind: "ident",
        component: "Amount"
      })
    );
    expect(await findStyleSource(ctx, "giftAmount")).toEqual({
      kind: "ident",
      path: "features/gift/popups/daily-gift.tsx",
      line: 2,
      range: [1, 9, 5, 11],
      ref: { kind: "const", name: "amountRow" },
      files: ["shared/views/styles.ts"],
      stylePath: "shared/views/amount.tsx"
    });

    ctx.link.projectValue = projectOn();
    const alone = await findStyleSource(ctx, "giftAmount");
    expect(alone?.kind === "ident" ? alone.files : []).toEqual(["shared/views/amount.tsx"]);
  });

  it("takes only the pattern the prop fills in its own component: no other hole, component or `*` pattern", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": AMOUNT.join("\n")
    });

    // `{id}` is not the hole of `amountKey=`; another component's pattern is not this element.
    answer(
      ctx,
      "jsx:giftReward",
      GIFT_PROP,
      { ...AMOUNT_TEXT, key: "{id}" },
      { ...AMOUNT_TEXT, component: "Prize" },
      { ...AMOUNT_TEXT, key: "gift*", stem: "gift" }
    );
    expect(await findStyleSource(ctx, "giftReward")).toEqual(GIFT_DEFINED);
  });

  it("never takes a pattern written in a helper: a later answer with no component", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": AMOUNT.join("\n")
    });
    const helper = place(AMOUNT_TEXT.path, AMOUNT_TEXT.range, {
      key: "{amountKey}",
      kind: "ident"
    });

    // The index does not say which component calls the helper: any id prop would fill it.
    answer(ctx, "jsx:giftReward", GIFT_PROP, helper);
    expect(await findStyleSource(ctx, "giftReward")).toEqual(GIFT_DEFINED);

    // An id prop the index names no component for fills no pattern either.
    const { range } = GIFT_PROP;
    const bare = place(GIFT_PROP.path, range, { line: 3, kind: "idProp", prop: "amountKey" });
    answer(ctx, "jsx:giftReward", bare, helper);
    expect(await findStyleSource(ctx, "giftReward")).toEqual(GIFT_DEFINED);
  });

  it("never takes a later answer with an undefined key", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": AMOUNT.join("\n")
    });
    const keyless = place(AMOUNT_TEXT.path, AMOUNT_TEXT.range, {
      kind: "ident",
      component: "Amount"
    });
    answer(ctx, "jsx:giftReward", GIFT_PROP, keyless);

    expect(await findStyleSource(ctx, "giftReward")).toEqual(GIFT_DEFINED);
  });

  it("takes the same-named component the id prop's file imports by a relative path, not the first one answered", async () => {
    const ctx = twoBoards('import { Board } from "../ui/board";');

    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      kind: "ident",
      path: "features/settings/settings.tsx",
      line: 2,
      range: [2, 1, 2, 29],
      ref: { kind: "const", name: "uiBoard" },
      files: ["features/ui/board.tsx"],
      stylePath: "features/ui/board.tsx"
    });
  });

  it("takes the same-named component of a folder: the import names the folder, the component is its index.tsx", async () => {
    const ctx = twoBoards('import { Board } from "../ui/board";', "features/ui/board/index.tsx");

    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      kind: "ident",
      path: "features/settings/settings.tsx",
      line: 2,
      range: [2, 1, 2, 29],
      ref: { kind: "const", name: "uiBoard" },
      files: ["features/ui/board/index.tsx"],
      stylePath: "features/ui/board/index.tsx"
    });
  });

  it("takes the same-named component a `type` import, a default import or a `.js` specifier names", async () => {
    const lines = [
      'import { type Board } from "../ui/board";',
      'import Board from "../ui/board";',
      'import { Board } from "../ui/board.js";'
    ];
    for (const line of lines) {
      const source = await findStyleSource(twoBoards(line), "settingsBoard");
      expect(source, line).toMatchObject({
        ref: { kind: "const", name: "uiBoard" },
        stylePath: "features/ui/board.tsx"
      });
    }
  });

  it("takes no style when two files write a component of that name and the import does not say which", async () => {
    const ctx = twoBoards('import { Board } from "@ui";');

    // An alias cannot be followed here: no style is better than the style of another Board.
    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      kind: "defined",
      path: "features/settings/settings.tsx",
      line: 2,
      range: [2, 1, 2, 29]
    });
  });

  it("takes the component written in the file of the id prop over a same-named one in another file", async () => {
    const ctx = twoBoards("<panel key={props.id} style={ownBoard} />");
    answer(
      ctx,
      "jsx:settingsBoard",
      BOARD_PROP,
      place("features/shop/board.tsx", [1, 1, 1, 43], BOARD_PANEL),
      place("features/settings/settings.tsx", [1, 1, 1, 42], BOARD_PANEL)
    );

    const source = await findStyleSource(ctx, "settingsBoard");

    expect(source?.kind === "ident" ? source.ref.name : undefined).toBe("ownBoard");
    expect(source).not.toHaveProperty("stylePath");
    expect(source).not.toHaveProperty("stylelessPaths");
  });

  it("keeps the component files that gave no style: no style on the tag, or a file that cannot be read", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": AMOUNT.join("\n")
    });

    // The pattern of the component has no style on its tag: the id prop is defined at its line.
    answer(ctx, "jsx:giftReward", GIFT_PROP, { ...AMOUNT_TEXT, range: [3, 5, 3, 11] });
    expect(await findStyleSource(ctx, "giftReward")).toEqual({
      ...GIFT_DEFINED,
      stylelessPaths: ["shared/views/amount.tsx"]
    });

    // A component file that cannot be read has no style to show.
    answer(ctx, "jsx:giftReward", GIFT_PROP, { ...AMOUNT_TEXT, path: "gone.tsx" });
    expect(await findStyleSource(ctx, "giftReward")).toEqual({
      ...GIFT_DEFINED,
      stylelessPaths: ["gone.tsx"]
    });

    // Two answers of the component in one file, none with a style: the file is kept once.
    const bare = { ...AMOUNT_TEXT, range: [3, 5, 3, 11] } as const;
    answer(ctx, "jsx:giftReward", GIFT_PROP, bare, { ...bare, line: 3 });
    expect(await findStyleSource(ctx, "giftReward")).toEqual({
      ...GIFT_DEFINED,
      stylelessPaths: ["shared/views/amount.tsx"]
    });

    // The second answer has the style: its file gave it, so it is not a file without one.
    answer(ctx, "jsx:giftReward", GIFT_PROP, bare, AMOUNT_TEXT);
    expect(await findStyleSource(ctx, "giftReward")).toEqual({
      ...GIFT_DEFINED,
      textStyle: "ui.amount",
      stylePath: "shared/views/amount.tsx"
    });
  });

  it("skips a component file that changed since the index answered: the range is of other lines", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": GIFT.join("\n"),
      "shared/views/amount.tsx": ['<text key="other" style="ui.title" />', ...AMOUNT].join("\n")
    });

    // The answer is of the bytes before a line was added: its range now opens the row.
    answer(ctx, "jsx:giftReward", GIFT_PROP, { ...AMOUNT_TEXT, hash: "before-the-edit" });
    expect(await findStyleSource(ctx, "giftReward")).toEqual({
      ...GIFT_DEFINED,
      stylelessPaths: ["shared/views/amount.tsx"]
    });

    // The index answers from the bytes on disk again: the range is of the text read.
    answer(ctx, "jsx:giftReward", GIFT_PROP, { ...AMOUNT_TEXT, range: [3, 7, 3, 78] });
    expect(await findStyleSource(ctx, "giftReward")).toEqual({
      ...GIFT_DEFINED,
      textStyle: "ui.amount",
      stylePath: "shared/views/amount.tsx"
    });
  });

  it("skips a later answer in the key file when the text read is not its version", async () => {
    const view = ['<Amount amountKey="giftReward" />', ...AMOUNT];
    const ctx = createCtx({ "features/gift/view.tsx": view.join("\n") });
    const prop = place("features/gift/view.tsx", [1, 1, 1, 34], {
      key: "giftReward",
      kind: "idProp",
      component: "Amount",
      prop: "amountKey"
    });
    const text = place("features/gift/view.tsx", [3, 7, 3, 78], {
      key: "{amountKey}",
      kind: "ident",
      component: "Amount"
    });

    // The file changed twice between the answers and the reads: the last answers stay, stale.
    answer(ctx, "jsx:giftReward", { ...prop, hash: "stale" }, { ...text, hash: "stale" });
    const source = await findStyleSource(ctx, "giftReward");
    expect(source).toEqual({
      kind: "defined",
      path: "features/gift/view.tsx",
      line: 1,
      range: [1, 1, 1, 34]
    });

    answer(ctx, "jsx:giftReward", prop, text);
    expect(await findStyleSource(ctx, "giftReward")).toMatchObject({ textStyle: "ui.amount" });
  });

  it("never gives a literal key the style of a `*` pattern that reads as it (cardRow is not a card)", async () => {
    const view = [
      '<row key="cardRow">',
      "  <column key={id} style={cardStyle(props.slot)} />",
      "</row>"
    ];
    const ctx = createCtx({ "features/ui/view.tsx": view.join("\n") });
    answer(
      ctx,
      "jsx:cardRow",
      place("features/ui/view.tsx", [1, 1, 3, 7], { key: "cardRow", kind: "literal" }),
      place("features/ui/view.tsx", [2, 3, 2, 52], { key: "card*", kind: "ident", stem: "card" })
    );
    const find = vi.spyOn(ctx.link.files, "find");

    expect(await findStyleSource(ctx, "cardRow")).toEqual({
      kind: "defined",
      path: "features/ui/view.tsx",
      line: 1,
      range: [1, 1, 3, 7]
    });
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("keeps the style of the id prop's own tag: the component file is not read", async () => {
    const ctx = createCtx({
      "features/gift/popups/daily-gift.tsx": [
        '<Amount amountKey="giftReward" style={giftRow} />'
      ].join("\n"),
      "shared/views/amount.tsx": AMOUNT.join("\n")
    });
    answer(ctx, "jsx:giftReward", { ...GIFT_PROP, line: 1, range: [1, 1, 1, 50] }, AMOUNT_TEXT);
    const find = vi.spyOn(ctx.link.files, "find");
    const read = vi.spyOn(ctx.link.files, "read");

    const source = await findStyleSource(ctx, "giftReward");

    expect(source?.kind === "ident" ? source.ref.name : undefined).toBe("giftRow");
    expect(source).not.toHaveProperty("stylePath");
    expect(source).not.toHaveProperty("stylelessPaths");
    expect(find).toHaveBeenCalledTimes(1);
    expect(read.mock.calls).toEqual([["features/gift/popups/daily-gift.tsx"]]);
  });

  it("returns a style call with the line of the call and the style key the index has (G2)", async () => {
    const ctx = createCtx({ "features/ui/kit.tsx": KIT.join("\n") });
    answer(ctx, "jsx:settingsBoard", place("features/ui/kit.tsx", [2, 5, 8, 13], { line: 3 }));
    const call = {
      kind: "call",
      path: "features/ui/kit.tsx",
      line: 3,
      range: [2, 5, 8, 13],
      call: "boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)",
      callLine: 4
    };
    expect(await findStyleSource(ctx, "settingsBoard")).toEqual(call);

    ctx.link.projectValue = projectOn({
      "style:features/ui/kit.tsx#boardOf": ["features/ui/kit.tsx"]
    });
    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      ...call,
      styleKey: "style:features/ui/kit.tsx#boardOf"
    });
  });

  it("keeps the text style key of a text node", async () => {
    const ctx = createCtx({ "a.tsx": '<text key="resetLabel" style="ui.link" content={x} />' });
    answer(ctx, "jsx:resetLabel", place("a.tsx", [1, 1, 1, 54]));
    expect(await findStyleSource(ctx, "resetLabel")).toEqual({
      kind: "defined",
      path: "a.tsx",
      line: 1,
      range: [1, 1, 1, 54],
      textStyle: "ui.link"
    });
  });

  it("is undefined for a key the index does not know, and forgets an older answer", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": HUD });
    ctx.state.found.set("hudRow", {
      kind: "defined",
      path: "gone.tsx",
      line: 1,
      range: [1, 1, 1, 2]
    });
    expect(await findStyleSource(ctx, "hudRow")).toBeUndefined();
    expect(ctx.state.found.has("hudRow")).toBe(false);
  });

  it("is undefined when the index is off (find rejects) or the file cannot be read", async () => {
    const ctx = createCtx();
    vi.spyOn(ctx.link.files, "find").mockRejectedValue(new Error("project index off: disabled"));
    expect(await findStyleSource(ctx, "coinPill")).toBeUndefined();

    const gone = createCtx();
    answer(gone, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
    expect(await findStyleSource(gone, "coinPill")).toBeUndefined();
  });

  it("asks once more when the file changed between the answer and the read", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": HUD });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42], { hash: "older" }));
    const find = vi.spyOn(ctx.link.files, "find");
    const source = await findStyleSource(ctx, "coinPill");
    expect(find).toHaveBeenCalledTimes(2);
    expect(source?.line).toBe(2);
  });
});

/** The tiny project fixture: a kit, the styles and one view file. */
const TINY_PROJECT = new URL("../fixtures/tiny-project", import.meta.url).pathname;

/**
 * A ctx whose files and index are the tiny project fixture: `find` is the game's project index on
 * the fixture folder, `read` the file with its sha1 as the version (the files plugin's hash).
 */
describe("findStyleSource on the tiny project index", () => {
  let ctx: TestCtx;
  let close: () => void;

  beforeAll(async () => {
    const { openProject } = await import("@moku-labs/game/project");
    const project = await openProject({ root: TINY_PROJECT });
    close = () => project.close();
    ctx = createCtx();
    vi.spyOn(ctx.link.files, "find").mockImplementation(async key => await project.find(key));
    vi.spyOn(ctx.link.files, "read").mockImplementation(file => {
      const text = readFileSync(path.join(TINY_PROJECT, file), "utf8");
      // eslint-disable-next-line sonarjs/hashing -- the files plugin's content version, not security
      const version = createHash("sha1").update(text).digest("hex");
      return Promise.resolve({ text, version });
    });
  });

  afterAll(() => {
    close();
  });

  it("answers settingsBoard with view.tsx:36, the board from line 35, and the style of the panel Board draws", async () => {
    // The real index names the component on both answers: the prop on <Board>, the panel in Board.
    const answers = await ctx.link.files.find("jsx:settingsBoard");
    expect(
      answers.map(({ kind, component, prop, key }) => ({ kind, component, prop, key }))
    ).toEqual([
      { kind: "idProp", component: "Board", prop: "id", key: "settingsBoard" },
      { kind: "ident", component: "Board", prop: undefined, key: "{id}" }
    ]);

    expect(await findStyleSource(ctx, "settingsBoard")).toEqual({
      kind: "ident",
      path: "features/ui/view.tsx",
      line: 36,
      range: [35, 7, 40, 15],
      ref: { kind: "const", name: "boardStyle" },
      files: ["features/ui/view.tsx"]
    });
  });

  it("answers the plain row cardRow with view.tsx:51 and no style: `card*` reads as it, but is not it", async () => {
    expect(await findStyleSource(ctx, "cardRow")).toEqual({
      kind: "defined",
      path: "features/ui/view.tsx",
      line: 51,
      range: [51, 5, 54, 11]
    });
  });

  it("answers the order card card0 with the element view.tsx:23 and its style call (D-47)", async () => {
    expect(await findStyleSource(ctx, "card0")).toEqual({
      kind: "call",
      path: "features/ui/view.tsx",
      line: 23,
      range: [22, 5, 28, 14],
      call: "cardStyle(props.slot)",
      callLine: 25
    });
  });
});
