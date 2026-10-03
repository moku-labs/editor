/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { readdirSync } from "node:fs";
import { read, sources } from "@moku-labs/game/inspect";
import { describe, expect, it } from "vitest";
import { MERGE_GAME_DIR } from "../../../../../tests/fixtures/game-dir";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";
import {
  flowFile,
  kebab,
  nodeFile,
  parseOverrides,
  SOURCE_OVERRIDES_PATH,
  SOURCE_ROOTS
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// The node → file rule (R1): one `it` per step of the rule table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A file index from a list of paths.
 *
 * @param paths - Relative posix paths.
 * @returns The `exists` function of the rule.
 */
const indexOf =
  (...paths: string[]) =>
  (path: string): boolean =>
    paths.includes(path);

describe("constants", () => {
  it("roots are '' then 'src/' and the override file is .moku/editor/files.json", () => {
    expect(SOURCE_ROOTS).toEqual(["", "src/"]);
    expect(SOURCE_OVERRIDES_PATH).toBe(".moku/editor/files.json");
  });
});

describe("kebab", () => {
  it.each([
    ["awaitIntent", "await-intent"],
    ["HTTPServer", "http-server"],
    ["level2Boss", "level2-boss"],
    ["main", "main"],
    ["getHTTPServer", "get-http-server"],
    ["tap_generator", "tap-generator"],
    ["daily gift", "daily-gift"],
    ["a__b--c", "a-b-c"]
  ])("%s → %s", (name, expected) => {
    expect(kebab(name)).toBe(expected);
  });
});

describe("flowFile", () => {
  it("step 1: an override string wins when the file exists", () => {
    const exists = indexOf("game/board-flow.ts", "flows/board.ts");

    expect(flowFile("board", { board: "game/board-flow.ts" }, exists)).toBe("game/board-flow.ts");
  });

  it("step 1: an override string to a missing file gives undefined (no fallback)", () => {
    expect(flowFile("board", { board: "gone.ts" }, indexOf("flows/board.ts"))).toBeUndefined();
  });

  it("step 1: an override null means no file", () => {
    expect(flowFile("board", { board: null }, indexOf("flows/board.ts"))).toBeUndefined();
  });

  it("step 3: the convention tries flows/<flow>.ts under '' then 'src/'", () => {
    expect(flowFile("board", {}, indexOf("flows/board.ts", "src/flows/board.ts"))).toBe(
      "flows/board.ts"
    );
    expect(flowFile("board", {}, indexOf("src/flows/board.ts"))).toBe("src/flows/board.ts");
  });

  it("step 3: ignores node overrides of the flow", () => {
    expect(flowFile("board", { "board/*": "x.ts" }, indexOf("flows/board.ts", "x.ts"))).toBe(
      "flows/board.ts"
    );
  });

  it("step 4: undefined when nothing exists", () => {
    expect(flowFile("board", {}, indexOf())).toBeUndefined();
  });
});

describe("nodeFile", () => {
  const ref = { flow: "board", node: "awaitIntent" };

  it("step 1: the flow/node override wins", () => {
    const exists = indexOf("custom/await.ts", "nodes/await-intent.ts");

    expect(nodeFile(ref, undefined, { "board/awaitIntent": "custom/await.ts" }, exists)).toBe(
      "custom/await.ts"
    );
  });

  it("step 1: flow/node beats flow/*", () => {
    const overrides = { "board/awaitIntent": "a.ts", "board/*": "b.ts" };

    expect(nodeFile(ref, undefined, overrides, indexOf("a.ts", "b.ts"))).toBe("a.ts");
  });

  it("step 1: flow/* applies when there is no flow/node key", () => {
    expect(
      nodeFile(ref, undefined, { "board/*": "board/nodes.ts" }, indexOf("board/nodes.ts"))
    ).toBe("board/nodes.ts");
  });

  it("step 1: an override to a missing file or null gives undefined", () => {
    const exists = indexOf("nodes/await-intent.ts");

    expect(nodeFile(ref, undefined, { "board/awaitIntent": "gone.ts" }, exists)).toBeUndefined();
    expect(nodeFile(ref, undefined, { "board/awaitIntent": null }, exists)).toBeUndefined();
    expect(nodeFile(ref, undefined, { "board/*": null }, exists)).toBeUndefined();
  });

  it("step 1: the override applies even to a sub-flow node", () => {
    expect(nodeFile(ref, { subFlow: "x" }, { "board/awaitIntent": "a.ts" }, indexOf("a.ts"))).toBe(
      "a.ts"
    );
  });

  it("step 2: a sub-flow node or a slot node has no own file", () => {
    const exists = indexOf("nodes/await-intent.ts");

    expect(nodeFile(ref, { subFlow: "board" }, {}, exists)).toBeUndefined();
    expect(nodeFile(ref, { slot: "afterOrder" }, {}, exists)).toBeUndefined();
  });

  it("step 3: nodes/<kebab>.ts, then .tsx, under '' then 'src/'", () => {
    expect(nodeFile(ref, {}, {}, indexOf("nodes/await-intent.tsx", "nodes/await-intent.ts"))).toBe(
      "nodes/await-intent.ts"
    );
    expect(
      nodeFile(ref, {}, {}, indexOf("nodes/await-intent.tsx", "src/nodes/await-intent.ts"))
    ).toBe("nodes/await-intent.tsx");
    expect(nodeFile(ref, {}, {}, indexOf("src/nodes/await-intent.tsx"))).toBe(
      "src/nodes/await-intent.tsx"
    );
  });

  it("step 4: undefined when nothing exists", () => {
    expect(nodeFile(ref, undefined, {}, indexOf("nodes/awaitintent.ts"))).toBeUndefined();
  });
});

describe("parseOverrides", () => {
  it("reads flow, flow/node and flow/* keys with null or relative paths", () => {
    const { overrides, problems } = parseOverrides(
      JSON.stringify({
        board: "game/board.ts",
        "board/awaitIntent": null,
        "settingsPopup/*": "features/settings/nodes.ts"
      })
    );

    expect(overrides).toEqual({
      board: "game/board.ts",
      "board/awaitIntent": null,
      "settingsPopup/*": "features/settings/nodes.ts"
    });
    expect(problems).toEqual([]);
  });

  it("drops bad values and names them in problems", () => {
    const { overrides, problems } = parseOverrides(
      JSON.stringify({
        a: "/abs.ts",
        b: "../x.ts",
        c: String.raw`a\b.ts`,
        d: 3,
        e: "",
        f: "nested/../../up.ts",
        g: "ok/fine.ts"
      })
    );

    expect(overrides).toEqual({ g: "ok/fine.ts" });
    expect(problems).toHaveLength(6);
    expect(problems.join("\n")).toContain('"a"');
    expect(problems.join("\n")).toContain('"d"');
  });

  it("drops bad keys and names them in problems", () => {
    const { overrides, problems } = parseOverrides(
      JSON.stringify({
        "": "a.ts",
        "a/b/c": "a.ts",
        "/a": "a.ts",
        "a/": "a.ts",
        "*": "a.ts",
        ok: "a.ts"
      })
    );

    expect(overrides).toEqual({ ok: "a.ts" });
    expect(problems).toHaveLength(5);
  });

  it("invalid JSON gives {} and one problem", () => {
    const { overrides, problems } = parseOverrides("{ nope");

    expect(overrides).toEqual({});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(SOURCE_OVERRIDES_PATH);
  });

  it.each([
    ["an array", "[]"],
    ["a string", '"x"'],
    ["null", "null"]
  ])("a top level that is %s gives {} and one problem", (_label, text) => {
    const { overrides, problems } = parseOverrides(text);

    expect(overrides).toEqual({});
    expect(problems).toHaveLength(1);
  });

  it("keeps a __proto__ key as data, never as the prototype", () => {
    const { overrides, problems } = parseOverrides('{"__proto__":"x.ts"}');

    expect(Object.getPrototypeOf(overrides)).toBe(Object.prototype);
    expect(Object.hasOwn(overrides, "__proto__")).toBe(true);
    expect(problems).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rule on the real merge-game fixture: its graph and its files
// ─────────────────────────────────────────────────────────────────────────────

describe("merge-game fixture", () => {
  const files = new Set(
    readdirSync(MERGE_GAME_DIR, { recursive: true, encoding: "utf8" }).map(path =>
      path.replaceAll("\\", "/")
    )
  );
  const exists = (path: string): boolean => files.has(path);

  it("board/awaitIntent → nodes/await-intent.ts", async () => {
    const { createGame } = await loadMergeGame();
    const graph = read(createGame().app, sources.graph);
    const node = graph.flows.board?.nodes.awaitIntent;

    expect(node).toMatchObject({ flow: "board", node: "awaitIntent", rest: true, scene: "board" });
    expect(nodeFile({ flow: "board", node: "awaitIntent" }, node, {}, exists)).toBe(
      "nodes/await-intent.ts"
    );
  });

  it("main/board (a sub-flow node) → undefined; the board flow → flows/board.ts", async () => {
    const { createGame } = await loadMergeGame();
    const graph = read(createGame().app, sources.graph);
    const node = graph.flows.main?.nodes.board;

    expect(node?.subFlow).toBe("board");
    expect(nodeFile({ flow: "main", node: "board" }, node, {}, exists)).toBeUndefined();
    expect(flowFile("board", {}, exists)).toBe("flows/board.ts");
  });

  it("the settingsPopup/* override applies to the settings nodes", async () => {
    const { createGame } = await loadMergeGame();
    const graph = read(createGame().app, sources.graph);
    const settings = graph.flows.settingsPopup;
    const { overrides } = parseOverrides('{ "settingsPopup/*": "features/settings/nodes.ts" }');

    const names = Object.keys(settings?.nodes ?? {});

    expect(names).toEqual(["enter", "open", "setVolume", "setLocale", "rename", "confirm"]);
    // The override is step 1: it applies to every node of the flow, before the sub-flow rule.
    for (const name of names) {
      const node = settings?.nodes[name];
      expect(nodeFile({ flow: "settingsPopup", node: name }, node, overrides, exists)).toBe(
        "features/settings/nodes.ts"
      );
    }
    expect(
      nodeFile({ flow: "settingsPopup", node: names[0] ?? "" }, undefined, {}, exists)
    ).toBeUndefined();
  });
});
