import { describe, expect, it } from "vitest";
import {
  childrenOf,
  countFiles,
  filesInTreeOrder,
  nameOf,
  parentOf,
  revealPath,
  toggleFolder,
  visibleRows
} from "../../tree/model";
import type { FileIndex } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// The pure tree model: children order, reveal, count, visible rows, tree order
// ─────────────────────────────────────────────────────────────────────────────

const file = (path: string, size = 10) => ({ path, kind: "file" as const, size });

const INDEX: FileIndex = {
  files: new Map(
    ["README.md", "flows/board.ts", "flows/main.ts", "nodes/merge.ts", "nodes/deep/x.ts"].map(
      path => [path, file(path)]
    )
  ),
  children: new Map<string, readonly string[]>([
    ["", ["flows", "nodes", ".moku", "README.md"]],
    ["flows", ["flows/board.ts", "flows/main.ts"]],
    ["nodes", ["nodes/deep", "nodes/merge.ts"]],
    ["nodes/deep", ["nodes/deep/x.ts"]],
    [".moku", [".moku/captures"]],
    [".moku/captures", []]
  ]),
  builtAt: 1000,
  truncated: false
};

describe("childrenOf", () => {
  it("returns the children of a folder, folders first, and [] for an unknown folder", () => {
    expect(childrenOf(INDEX, "")).toEqual(["flows", "nodes", ".moku", "README.md"]);
    expect(childrenOf(INDEX, "nodes")).toEqual(["nodes/deep", "nodes/merge.ts"]);
    expect(childrenOf(INDEX, "nope")).toEqual([]);
  });
});

describe("countFiles", () => {
  it("counts files only", () => {
    expect(countFiles(INDEX)).toBe(5);
  });
});

describe("revealPath", () => {
  it("expands every ancestor folder of a path", () => {
    const expanded = new Set<string>();
    revealPath(expanded, "nodes/deep/x.ts");
    expect([...expanded]).toEqual(["nodes", "nodes/deep"]);
  });

  it("adds nothing for a root file", () => {
    const expanded = new Set<string>();
    revealPath(expanded, "README.md");
    expect(expanded.size).toBe(0);
  });
});

describe("parentOf and nameOf", () => {
  it("split a path", () => {
    expect(parentOf("nodes/deep/x.ts")).toBe("nodes/deep");
    expect(parentOf("README.md")).toBe("");
    expect(nameOf("nodes/deep/x.ts")).toBe("x.ts");
    expect(nameOf("README.md")).toBe("README.md");
  });
});

describe("toggleFolder", () => {
  it("opens a closed folder and closes an open one", () => {
    const expanded = new Set<string>();
    expect(toggleFolder(expanded, "flows")).toBe(true);
    expect(expanded.has("flows")).toBe(true);
    expect(toggleFolder(expanded, "flows")).toBe(false);
    expect(expanded.has("flows")).toBe(false);
  });
});

describe("visibleRows", () => {
  it("lists the root children with closed folders", () => {
    expect(visibleRows(INDEX, new Set()).map(row => row.path)).toEqual([
      "flows",
      "nodes",
      ".moku",
      "README.md"
    ]);
  });

  it("descends into open folders with levels", () => {
    const rows = visibleRows(INDEX, new Set(["nodes", "nodes/deep"]));
    expect(rows.map(row => [row.path, row.level, row.kind, row.expanded])).toEqual([
      ["flows", 1, "dir", false],
      ["nodes", 1, "dir", true],
      ["nodes/deep", 2, "dir", true],
      ["nodes/deep/x.ts", 3, "file", false],
      ["nodes/merge.ts", 2, "file", false],
      [".moku", 1, "dir", false],
      ["README.md", 1, "file", false]
    ]);
    expect(rows[2]?.name).toBe("deep");
  });
});

describe("filesInTreeOrder", () => {
  it("walks the tree depth first, folders first, files only", () => {
    expect(filesInTreeOrder(INDEX).map(entry => entry.path)).toEqual([
      "flows/board.ts",
      "flows/main.ts",
      "nodes/deep/x.ts",
      "nodes/merge.ts",
      "README.md"
    ]);
  });
});
