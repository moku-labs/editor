import { afterEach, describe, expect, it } from "vitest";
import { wireError } from "../../../../registry/protocol";
import {
  filesFindTool,
  filesListTool,
  filesReadTool,
  filesWriteTool,
  isPrivatePath,
  projectTool
} from "../../../mcp/file-tools";
import { checkArguments } from "../../../mcp/schema";
import { until } from "../../fake-hub";
import type { ToolSetup } from "../../mcp-tools";
import { jsonOf, textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp files tools (M5, M6): list, read and write through the hub's
// files channel; the bin's .moku/editor.json (the token) and .moku/editor.log
// are hidden and refused. moku_files_find asks the project index where a key
// lives (files.find); moku_project reads the index state the hub published.
// ─────────────────────────────────────────────────────────────────────────────

let setup: ToolSetup | undefined;

afterEach(async () => {
  await setup?.cleanup();
  setup = undefined;
});

/** The setup of a test, kept for the cleanup. */
async function ready(options: Parameters<typeof toolSetup>[0] = {}): Promise<ToolSetup> {
  setup = await toolSetup(options);
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

/** The project index of a small game, as the hub publishes it. */
const PROJECT = {
  state: "on",
  revision: "r7",
  previous: "r6",
  manifest: "manifest.json",
  defs: {
    "flow:board": ["flows/board.ts"],
    "node:board/merge": ["nodes/merge.ts"],
    "node:board/catchUp": ["nodes/catch-up.ts"],
    "textStyle:ui.title": ["features/ui/text-styles.ts"],
    "style:features/ui/popup.tsx#popupScreen": ["features/ui/popup.tsx"]
  },
  uses: {
    "node:board/merge": ["flows/board.ts"],
    "node:board/catchUp": ["flows/board.ts"]
  },
  broken: { "nodes/draft.ts": "nodes/draft.ts:3:1 Unexpected token" },
  change: { files: ["nodes/merge.ts"], moved: [], removed: [] }
};

/**
 * A setup whose hub published a project state, read by the client.
 *
 * @param project - The published state.
 */
async function withProject(project: typeof PROJECT | { state: "off"; reason: string }) {
  const current = await ready({ project });
  await until(() => current.client.project() !== undefined, "the published project state");
  return current;
}

describe("moku_files_find", () => {
  it("asks files.find for the key and prints the places", async () => {
    const { run, hub } = await ready();
    hub.handle("files.find", () => [
      {
        path: "nodes/merge.ts",
        binding: "merge",
        line: 17,
        range: [17, 1, 30, 3],
        hash: "a1b2c3"
      },
      { path: "nodes/draft.ts", line: 4, range: [4, 1, 9, 3], hash: "d4e5f6", broken: true }
    ]);
    const { result } = await run(filesFindTool, { key: "node:board/merge" });
    expect(hub.requests).toEqual([
      { channel: "files", method: "find", params: { key: "node:board/merge" }, session: undefined }
    ]);
    expect(jsonOf(result)).toEqual([
      { path: "nodes/merge.ts", binding: "merge", line: 17, hash: "a1b2c3" },
      { path: "nodes/draft.ts", line: 4, hash: "d4e5f6", broken: true }
    ]);
    expect(result.isError).toBeUndefined();
  });

  it("answers a plain line for a key the index does not know", async () => {
    const { run, hub } = await ready();
    hub.handle("files.find", () => []);
    const { result } = await run(filesFindTool, { key: "jsx:coins" });
    expect(result).toEqual({ content: [{ type: "text", text: "No place for jsx:coins." }] });
  });

  it("answers isError with the reason while the project index is off", async () => {
    const { run, hub } = await ready();
    hub.handle("files.find", () => {
      throw wireError(-32_008, "project index off: disabled", { reason: "not_installed" });
    });
    const { result } = await run(filesFindTool, { key: "flow:board" });
    expect(result).toEqual({
      content: [{ type: "text", text: "project index off: disabled" }],
      isError: true
    });
  });

  it("answers isError for an answer that is not a list of places", async () => {
    const { run, hub } = await ready();
    hub.handle("files.find", () => [{ path: "nodes/merge.ts" }]);
    const { result } = await run(filesFindTool, { key: "node:board/merge" });
    expect(result).toEqual({
      content: [{ type: "text", text: "files.find answered no places." }],
      isError: true
    });
  });

  it("takes exactly a key of 1 to 512 characters and only reads", () => {
    const { inputSchema } = filesFindTool;
    expect(inputSchema).toEqual({
      type: "object",
      properties: {
        key: { type: "string", minLength: 1, maxLength: 512, description: expect.any(String) }
      },
      required: ["key"],
      additionalProperties: false
    });
    expect(checkArguments(inputSchema, {})).toBe("key is required");
    expect(checkArguments(inputSchema, { key: "" })).toBe("key must not be empty");
    expect(checkArguments(inputSchema, { key: "k".repeat(513) })).toBe(
      "key must be at most 512 characters"
    );
    expect(checkArguments(inputSchema, { key: "k".repeat(512) })).toEqual({
      key: "k".repeat(512)
    });
    expect(checkArguments(inputSchema, { key: "flow:board", path: "a.ts" })).toBe(
      "path is not an argument of this tool"
    );
    expect(filesFindTool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });
});

describe("moku_project", () => {
  it("summarises the published state: revision, manifest, the key count, the prefixes and the broken files", async () => {
    const { run, hub } = await withProject(PROJECT);
    const { result } = await run(projectTool);
    expect(jsonOf(result)).toEqual({
      state: "on",
      revision: "r7",
      manifest: "manifest.json",
      keys: 5,
      broken: { "nodes/draft.ts": "nodes/draft.ts:3:1 Unexpected token" },
      prefixes: { "flow:": 1, "node:": 2, "textStyle:": 1, "style:": 1 }
    });
    expect(hub.requests).toEqual([]);
  });

  it("leaves the manifest out when the game has none", async () => {
    const { state, revision, defs, uses, broken } = PROJECT;
    const current = await ready({ project: { state, revision, defs, uses, broken } });
    await until(() => current.client.project() !== undefined, "the published project state");
    const { result } = await current.run(projectTool);
    expect(jsonOf(result)).toEqual({
      state: "on",
      revision: "r7",
      keys: 5,
      broken: PROJECT.broken,
      prefixes: { "flow:": 1, "node:": 2, "textStyle:": 1, "style:": 1 }
    });
  });

  it("lists the keys of a prefix with their def paths", async () => {
    const { run } = await withProject(PROJECT);
    const { result } = await run(projectTool, { prefix: "node:" });
    expect(jsonOf(result)).toEqual({
      "node:board/merge": ["nodes/merge.ts"],
      "node:board/catchUp": ["nodes/catch-up.ts"]
    });
    const narrow = await run(projectTool, { prefix: "node:board/m" });
    expect(jsonOf(narrow.result)).toEqual({ "node:board/merge": ["nodes/merge.ts"] });
  });

  it("names the prefixes the index has when no key starts with the asked one", async () => {
    const { run } = await withProject(PROJECT);
    const { result } = await run(projectTool, { prefix: "nodes:" });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "No key starts with nodes:. The index has flow:, node:, textStyle:, style:."
        }
      ]
    });
  });

  it.each([
    "jsx:",
    "jsx:coins",
    "jsx"
  ])("sends the prefix %s to moku_files_find: jsx keys never ride the state", async prefix => {
    const { run } = await withProject(PROJECT);
    const { result } = await run(projectTool, { prefix });
    expect(result).toEqual({
      content: [{ type: "text", text: "jsx keys are not in the index state; use moku_files_find" }]
    });
  });

  it("answers what a file defines and uses, and its parse error when it is broken", async () => {
    const { run } = await withProject(PROJECT);
    const board = await run(projectTool, { path: "flows/board.ts" });
    expect(jsonOf(board.result)).toEqual({
      defines: ["flow:board"],
      uses: ["node:board/merge", "node:board/catchUp"]
    });
    const spelled = await run(projectTool, { path: "./nodes//merge.ts" });
    expect(jsonOf(spelled.result)).toEqual({ defines: ["node:board/merge"], uses: [] });
    const draft = await run(projectTool, { path: "nodes/draft.ts" });
    expect(jsonOf(draft.result)).toEqual({
      defines: [],
      uses: [],
      broken: "nodes/draft.ts:3:1 Unexpected token"
    });
    // A file the index does not know, even one named like a member of every object.
    for (const path of ["nodes/other.ts", "constructor"]) {
      const other = await run(projectTool, { path });
      expect(jsonOf(other.result)).toEqual({ defines: [], uses: [] });
    }
  });

  it("counts a key without a prefix under its own name", async () => {
    const project = {
      state: "on",
      revision: "r1",
      defs: { orphan: ["a.ts"] },
      uses: {},
      broken: {}
    };
    const current = await ready({ project });
    await until(() => current.client.project() !== undefined, "the published project state");
    const { result } = await current.run(projectTool);
    expect(jsonOf(result)).toEqual({
      state: "on",
      revision: "r1",
      keys: 1,
      broken: {},
      prefixes: { orphan: 1 }
    });
  });

  it("answers isError for both path and prefix, without reading the state", async () => {
    const { run } = await withProject(PROJECT);
    const { result } = await run(projectTool, { path: "flows/board.ts", prefix: "node:" });
    expect(result).toEqual({
      content: [{ type: "text", text: "pass at most one of path (a file) or prefix (keys)" }],
      isError: true
    });
  });

  it("answers the off state with its reason, whatever is asked", async () => {
    const { run } = await withProject({ state: "off", reason: "disabled" });
    for (const args of [{}, { prefix: "node:" }, { path: "flows/board.ts" }]) {
      const { result } = await run(projectTool, args);
      expect(jsonOf(result)).toEqual({ state: "off", reason: "disabled" });
      expect(result.isError).toBeUndefined();
    }
  });

  it("says so when the hub published no project state yet", async () => {
    const { run } = await ready();
    const { result } = await run(projectTool);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "moku-editor has not published the project index yet. Call moku_project again in a moment."
        }
      ]
    });
  });

  it("takes a closed object of two optional texts and only reads", () => {
    const { inputSchema } = projectTool;
    expect(inputSchema).toEqual({
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, description: expect.any(String) },
        prefix: { type: "string", minLength: 1, description: expect.any(String) }
      },
      additionalProperties: false
    });
    expect(checkArguments(inputSchema, { key: "node:" })).toBe(
      "key is not an argument of this tool"
    );
    expect(projectTool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });
});
