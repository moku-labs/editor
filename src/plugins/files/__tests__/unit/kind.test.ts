import { describe, expect, it } from "vitest";
import { classifyWrite } from "../../kind";
import type { WrittenKind } from "../../types";

const rows: ReadonlyArray<readonly [string, WrittenKind]> = [
  [".moku/captures/2026-09-24-1012-board.png", "capture"],
  [".moku/captures/series-x/index.json", "capture"],
  [".moku/notes/2026-09-24-first-top-item.md", "note"],
  [".moku/editor/layout.json", "layout"],
  ["features/ui/board.css", "style"],
  ["features/ui/styles.ts", "style"],
  ["styles.tsx", "style"],
  ["features/ui/board.styles.ts", "style"],
  ["features/ui/board.styles.tsx", "style"],
  ["src/nodes/merge.ts", "code"],
  ["src/ui/Board.tsx", "code"],
  ["package.json", "other"],
  ["README.md", "other"],
  [".moku/editor/other.json", "other"],
  [".moku/editor/layout.json.bak", "other"],
  ["src/mystyles.ts", "code"]
];

describe("classifyWrite", () => {
  it.each(rows)("%s → %s", (path, kind) => {
    expect(classifyWrite(path)).toBe(kind);
  });

  it("gives captures priority over the style rule", () => {
    expect(classifyWrite(".moku/captures/a.css")).toBe("capture");
  });

  it("gives notes priority over the code rule", () => {
    expect(classifyWrite(".moku/notes/a.ts")).toBe("note");
  });
});
