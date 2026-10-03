import { describe, expect, it } from "vitest";
import { editorUrlOf } from "../../shared/editor-url";

// ─────────────────────────────────────────────────────────────────────────────
// editorUrlOf (R9): the "Open in editor" link of flowView and filesView.
// ─────────────────────────────────────────────────────────────────────────────

const VSCODE = "vscode://file/{path}:{line}";

describe("editorUrlOf", () => {
  it("joins root and path with one slash and fills the line", () => {
    expect(editorUrlOf(VSCODE, "/Users/alex/game", "nodes/merge.ts", 12)).toBe(
      "vscode://file/Users/alex/game/nodes/merge.ts:12"
    );
  });

  it("never doubles the slash between root and path", () => {
    expect(editorUrlOf(VSCODE, "/Users/alex/game/", "nodes/merge.ts", 3)).toBe(
      "vscode://file/Users/alex/game/nodes/merge.ts:3"
    );
    expect(editorUrlOf(VSCODE, "/Users/alex/game/", "/nodes/merge.ts", 3)).toBe(
      "vscode://file/Users/alex/game/nodes/merge.ts:3"
    );
  });

  it("keeps a Windows root as it is", () => {
    expect(editorUrlOf(VSCODE, "C:/game", "nodes/merge.ts", 5)).toBe(
      "vscode://file/C:/game/nodes/merge.ts:5"
    );
  });

  it("defaults the line to 1 and encodes spaces", () => {
    expect(editorUrlOf(VSCODE, "/Users/alex/my game", "nodes/big merge.ts")).toBe(
      "vscode://file/Users/alex/my%20game/nodes/big%20merge.ts:1"
    );
  });

  it("uses 1 for a line that is not a positive integer", () => {
    expect(editorUrlOf(VSCODE, "/g", "a.ts", 0)).toBe("vscode://file/g/a.ts:1");
    expect(editorUrlOf(VSCODE, "/g", "a.ts", Number.NaN)).toBe("vscode://file/g/a.ts:1");
  });

  it("fills every placeholder, other templates included", () => {
    expect(editorUrlOf("cursor://file/{path}?l={line}&again={line}", "/g", "a.ts", 7)).toBe(
      "cursor://file/g/a.ts?l=7&again=7"
    );
  });

  it("returns undefined when the template or the root is empty", () => {
    expect(editorUrlOf("", "/g", "a.ts", 1)).toBeUndefined();
    expect(editorUrlOf(VSCODE, "", "a.ts", 1)).toBeUndefined();
  });
});
