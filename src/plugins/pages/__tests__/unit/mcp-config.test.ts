import { describe, expect, it } from "vitest";
import { mcpConfigLines } from "../../mcp-config";

// ─────────────────────────────────────────────────────────────────────────────
// pages mcp-config (M8): `moku-editor mcp-config` prints the `.mcp.json` snippet
// and the `claude mcp add` line for the same bridge arguments.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The JSON part of the printed lines (everything before the blank line).
 *
 * @param lines - The printed lines.
 * @returns The parsed snippet.
 */
function snippetOf(lines: readonly string[]): unknown {
  return JSON.parse(lines.slice(0, lines.indexOf("")).join("\n"));
}

describe("mcpConfigLines", () => {
  it("prints the .mcp.json snippet, a blank line and the claude mcp add line", () => {
    const lines = mcpConfigLines({ kind: "mcp-config", html: "web/index.html", port: 3000 });
    expect(snippetOf(lines)).toEqual({
      mcpServers: {
        "moku-editor": {
          type: "stdio",
          command: "bunx",
          args: ["moku-editor", "mcp", "web/index.html", "--port", "3000"]
        }
      }
    });
    expect(lines.at(-1)).toBe(
      "claude mcp add moku-editor -- bunx moku-editor mcp web/index.html --port 3000"
    );
  });

  it("leaves out the html and the port that were not given", () => {
    const lines = mcpConfigLines({ kind: "mcp-config" });
    expect(snippetOf(lines)).toEqual({
      mcpServers: {
        "moku-editor": { type: "stdio", command: "bunx", args: ["moku-editor", "mcp"] }
      }
    });
    expect(lines.at(-1)).toBe("claude mcp add moku-editor -- bunx moku-editor mcp");
  });

  it("quotes a path with spaces or quotes for the shell line only", () => {
    const lines = mcpConfigLines({ kind: "mcp-config", html: "my game/it's.html" });
    expect(lines.at(-1)).toBe(
      String.raw`claude mcp add moku-editor -- bunx moku-editor mcp 'my game/it'\''s.html'`
    );
    expect(lines.join("\n")).toContain('"my game/it\'s.html"');
  });
});
