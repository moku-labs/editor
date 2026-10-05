import { afterEach, describe, expect, it } from "vitest";
import { wireError } from "../../../../registry/protocol";
import {
  filesListTool,
  filesReadTool,
  filesWriteTool,
  isPrivatePath
} from "../../../mcp/file-tools";
import type { ToolSetup } from "../../mcp-tools";
import { jsonOf, textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp files tools (M5, M6): list, read and write through the hub's
// files channel; the bin's .moku/editor.json (the token) and .moku/editor.log
// are hidden and refused.
// ─────────────────────────────────────────────────────────────────────────────

let setup: ToolSetup | undefined;

afterEach(async () => {
  await setup?.cleanup();
  setup = undefined;
});

/** The setup of a test, kept for the cleanup. */
async function ready(): Promise<ToolSetup> {
  setup = await toolSetup();
  return setup;
}

describe("isPrivatePath", () => {
  it.each([
    ".moku/editor.json",
    "./.moku/editor.json",
    ".moku//editor.json",
    ".moku/./editor.json",
    ".MOKU/Editor.JSON",
    " .moku/editor.log ",
    ".moku/editor.json.4242.tmp",
    "src/../.moku/editor.log"
  ])("refuses %s", path => {
    expect(isPrivatePath(path)).toBe(true);
  });

  it.each([
    ".moku/captures/a.md",
    ".moku/editor.jsonc.md",
    "src/editor.json",
    ".moku"
  ])("allows %s", path => {
    expect(isPrivatePath(path)).toBe(false);
  });
});

describe("moku_files_list", () => {
  it("lists a folder without the bin's private files", async () => {
    const { run, hub } = await ready();
    hub.handle("files.list", () => [
      { path: ".moku/captures", kind: "dir", size: 0 },
      { path: ".moku/editor.json", kind: "file", size: 300 },
      { path: ".moku/editor.log", kind: "file", size: 9 },
      { path: ".moku/layout.json", kind: "file", size: 2, version: "v" }
    ]);
    const { result } = await run(filesListTool, { dir: ".moku" });
    expect(jsonOf(result)).toEqual([
      { path: ".moku/captures", kind: "dir", size: 0 },
      { path: ".moku/layout.json", kind: "file", size: 2, version: "v" }
    ]);
    expect(hub.requests[0]?.params).toEqual({ dir: ".moku" });
    await run(filesListTool);
    expect(hub.requests[1]?.params).toEqual({ dir: "" });
  });
});

describe("moku_files_read", () => {
  it("answers { path, version } then the text", async () => {
    const { run, hub } = await ready();
    hub.handle("files.read", () => ({ text: "export const a = 1;\n", version: "v1" }));
    const { result } = await run(filesReadTool, { path: "src/a.ts" });
    expect(JSON.parse(textAt(result))).toEqual({ path: "src/a.ts", version: "v1" });
    expect(textAt(result, 1)).toBe("export const a = 1;\n");
  });

  it("refuses the discovery file and the log without asking the hub", async () => {
    const { run, hub } = await ready();
    for (const path of [".moku/editor.json", "./.moku/editor.log"]) {
      const { result } = await run(filesReadTool, { path });
      expect(result.isError).toBe(true);
      expect(textAt(result)).toContain("it holds the session token");
    }
    expect(hub.requests).toEqual([]);
  });

  it("passes an unexpected answer through as JSON", async () => {
    const { run, hub } = await ready();
    hub.handle("files.read", () => ({ odd: true }));
    const oddRead = await run(filesReadTool, { path: "a.md" });
    expect(jsonOf(oddRead.result)).toEqual({ odd: true });
  });
});

describe("moku_files_write", () => {
  it("writes with the version and answers the write result", async () => {
    const { run, hub } = await ready();
    hub.handle("files.write", () => ({ path: "a.md", bytes: 3, version: "v2" }));
    const { result } = await run(filesWriteTool, { path: "a.md", text: "abc", version: "v1" });
    expect(jsonOf(result)).toEqual({ path: "a.md", bytes: 3, version: "v2" });
    expect(hub.requests[0]?.params).toEqual({ path: "a.md", text: "abc", version: "v1" });
    await run(filesWriteTool, { path: "b.md", text: "" });
    expect(hub.requests[1]?.params).toEqual({ path: "b.md", text: "" });
  });

  it("answers a version conflict as isError and refuses the private files", async () => {
    const { run, hub } = await ready();
    hub.handle("files.write", () => {
      throw wireError(-32_005, "a.md changed since v1", { reason: "version_conflict" });
    });
    const conflict = await run(filesWriteTool, { path: "a.md", text: "x", version: "v1" });
    expect(conflict.result).toEqual({
      content: [{ type: "text", text: "a.md changed since v1" }],
      isError: true
    });
    const refused = await run(filesWriteTool, { path: ".moku/editor.json", text: "{}" });
    expect(refused.result.isError).toBe(true);
    expect(hub.requests).toHaveLength(1);
  });
});
