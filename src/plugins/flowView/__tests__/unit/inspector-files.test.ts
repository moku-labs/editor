/* eslint-disable unicorn/no-null -- a null override means "no file of its own" */
import { describe, expect, it, vi } from "vitest";
import {
  fileOfNode,
  lineOf,
  loadSourceLookup,
  NO_FILE_FOUND,
  NO_OWN_FILE,
  noFileText
} from "../../inspector/files";
import { createTestCtx } from "../ctx";
import { cloneGraph, mergeGraph } from "../helpers";

describe("loadSourceLookup (R1)", () => {
  it("lists only nodes/, flows/, src/nodes/, src/flows/ and the override folders", async () => {
    const { ctx, fakes } = createTestCtx({
      files: {
        "nodes/merge.ts": "export const merge = 1;",
        "src/flows/board.ts": "",
        ".moku/editor/files.json": '{ "settingsPopup/*": "features/settings/nodes.ts" }',
        "features/settings/nodes.ts": ""
      }
    });
    const lookup = await loadSourceLookup(fakes.files, ctx.log);
    expect(vi.mocked(fakes.files.list).mock.calls.map(call => call[0])).toEqual([
      "nodes",
      "flows",
      "src/nodes",
      "src/flows",
      "features/settings"
    ]);
    expect([...lookup.exists].toSorted()).toEqual([
      "features/settings/nodes.ts",
      "nodes/merge.ts",
      "src/flows/board.ts"
    ]);
    expect(lookup.overrides).toEqual({ "settingsPopup/*": "features/settings/nodes.ts" });
  });

  it("warns once about bad override entries; a missing file means no overrides", async () => {
    const { ctx, fakes } = createTestCtx({
      files: { ".moku/editor/files.json": '{ "../x": "a.ts" }' }
    });
    await loadSourceLookup(fakes.files, ctx.log);
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("flowView:overrides-invalid", {
      problems: [expect.stringContaining("../x")]
    });
    const empty = createTestCtx();
    const lookup = await loadSourceLookup(empty.fakes.files, empty.ctx.log);
    expect(lookup.overrides).toEqual({});
    expect(empty.ctx.log.debug).toHaveBeenCalled();
  });
});

describe("fileOfNode", () => {
  const lookup = {
    exists: new Set(["nodes/merge.ts", "src/nodes/await-intent.ts", "features/settings/nodes.ts"]),
    overrides: { "settingsPopup/*": "features/settings/nodes.ts", "board/toast": null }
  };

  it("resolves through nodeFile: nodes/<kebab>.ts under the roots, overrides first", () => {
    expect(fileOfNode(lookup, mergeGraph, "board/merge")).toBe("nodes/merge.ts");
    expect(fileOfNode(lookup, mergeGraph, "board/awaitIntent")).toBe("src/nodes/await-intent.ts");
    expect(fileOfNode(lookup, mergeGraph, "settingsPopup/open")).toBe("features/settings/nodes.ts");
    expect(fileOfNode(lookup, mergeGraph, "board/catchUp")).toBeUndefined();
  });

  it("gives sub-flow, slot and null-override nodes no own file", () => {
    expect(fileOfNode(lookup, mergeGraph, "main/settings")).toBeUndefined();
    expect(noFileText(lookup, mergeGraph, "main/settings")).toBe(NO_OWN_FILE);
    expect(noFileText(lookup, mergeGraph, "main/afterOrder")).toBe(NO_OWN_FILE);
    expect(noFileText(lookup, mergeGraph, "board/toast")).toBe(NO_OWN_FILE);
    expect(noFileText(lookup, mergeGraph, "board/catchUp")).toBe(NO_FILE_FOUND);
  });

  it("prefers a graph node's own file (F-H2)", () => {
    const graph = cloneGraph();
    const merge = graph.flows.board?.nodes.merge;
    if (merge !== undefined) merge.file = "game/merge-node.ts";
    expect(fileOfNode(lookup, graph, "board/merge")).toBe("game/merge-node.ts");
  });
});

describe("lineOf", () => {
  it("finds the declaration, then a key, else line 1", () => {
    expect(lineOf("import x;\n\nexport const merge = node({});\n", "merge")).toBe(3);
    expect(lineOf("export function awaitIntent() {}", "awaitIntent")).toBe(1);
    expect(lineOf("a\nnodes({\n  merge: defineNode(),\n})", "merge")).toBe(3);
    expect(lineOf("nothing here", "merge")).toBe(1);
    expect(lineOf("let mergeAll = 1;\nlet merge = 2;", "merge")).toBe(2);
  });
});
