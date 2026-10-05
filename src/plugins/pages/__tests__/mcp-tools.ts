import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Json, SessionInfo } from "../../registry/protocol";
import { connectHub } from "../mcp/hub-client";
import { checkArguments } from "../mcp/schema";
import { runToolSafely } from "../mcp/tools";
import type {
  EditorLink,
  EditorStatus,
  HubClient,
  Tool,
  ToolContext,
  ToolResult
} from "../mcp/types";
import type { FakeHub } from "./fake-hub";
import { startFakeHub } from "./fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// The tool tests of the MCP bridge: a fake hub, a real hub client connected to
// it, an EditorLink stub over that client and a runner that checks the
// arguments like tools/call does.
// ─────────────────────────────────────────────────────────────────────────────

/** What a tool test works with. */
export type ToolSetup = {
  readonly root: string;
  readonly hub: FakeHub;
  readonly client: HubClient;
  readonly editor: EditorLink & {
    launch: Mock<EditorLink["launch"]>;
    stopOwned: Mock<EditorLink["stopOwned"]>;
  };
  readonly context: ToolContext;
  /** Runs a tool with raw arguments; returns its result and the progress reports. */
  run(
    tool: Tool,
    args?: Json,
    signal?: AbortSignal
  ): Promise<{ result: ToolResult; progress: [number, number | undefined][] }>;
  cleanup(): Promise<void>;
};

/**
 * Starts a fake hub and connects a client to it.
 *
 * @param options - The first sessions and the published hot reload state.
 * @param options.sessions - The sessions the fake hub sends on open.
 * @param options.hotReload - The hot reload state it sends on open, if any.
 */
export async function toolSetup(
  options: { sessions?: SessionInfo[]; hotReload?: Json } = {}
): Promise<ToolSetup> {
  const root = await mkdtemp(join(tmpdir(), "moku-mcp-tools-"));
  const hub = startFakeHub(options);
  const client = await connectHub(hub.discovery(root));
  const status: EditorStatus = { running: true, owned: false, bin: client.bin };
  const editor = {
    start: () => Promise.resolve(),
    hub: () => Promise.resolve(client),
    connected: () => client,
    status: () => status,
    launch: vi.fn<EditorLink["launch"]>(() => Promise.resolve(status)),
    stopOwned: vi.fn<EditorLink["stopOwned"]>(() => Promise.resolve({ stopped: false, status })),
    shutdown: () => Promise.resolve()
  };
  const context: ToolContext = { editor, now: Date.now };

  return {
    root,
    hub,
    client,
    editor,
    context,
    run: async (tool, args, signal = new AbortController().signal) => {
      const progress: [number, number | undefined][] = [];
      const checked = checkArguments(tool.inputSchema, args);
      if (typeof checked === "string") throw new Error(`bad test arguments: ${checked}`);
      const result = await runToolSafely(
        tool,
        { args: checked, signal, progress: (done, total) => progress.push([done, total]) },
        context
      );
      return { result, progress };
    },
    cleanup: async () => {
      client.close();
      await hub.stop();
      await rm(root, { recursive: true, force: true });
    }
  };
}

/**
 * The text of a result item.
 *
 * @param result - The tool result.
 * @param index - The item.
 */
export function textAt(result: ToolResult, index = 0): string {
  const item = result.content[index];
  return item?.type === "text" ? item.text : "";
}

/**
 * The parsed JSON of the first text item.
 *
 * @param result - The tool result.
 */
export function jsonOf(result: ToolResult): unknown {
  return JSON.parse(textAt(result));
}

/** A PNG data URL whose base64 data has `chars` characters. */
export function png(chars: number): string {
  return `data:image/png;base64,${"A".repeat(chars)}`;
}

/**
 * A PNG data URL with a real signature and IHDR (so its width can be read), padded with "A" to
 * `chars` base64 characters.
 *
 * @param width - The width in the header.
 * @param chars - The length of the base64 data.
 */
export function pngOf(width: number, chars: number): string {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(852, 20);
  const start = header.toString("base64");
  return `data:image/png;base64,${start}${"A".repeat(Math.max(0, chars - start.length))}`;
}

/**
 * A JPEG data URL with a real start (SOI, a JFIF APP0 segment, then a SOF0 or SOF2 frame header) so
 * its size can be read, padded with "A" to `chars` base64 characters.
 *
 * @param width - The width in the frame header (the height is 852).
 * @param chars - The length of the base64 data.
 * @param marker - The frame marker: 0xc0 (SOF0, baseline) or 0xc2 (SOF2, progressive).
 */
export function jpegOf(width: number, chars: number, marker = 0xc0): string {
  const start = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00
  ]);
  const frame = Buffer.alloc(19);
  frame[0] = 0xff;
  frame[1] = marker;
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(852, 5);
  frame.writeUInt16BE(width, 7);
  frame[9] = 3;
  const head = Buffer.concat([start, app0, frame]).toString("base64");
  return `data:image/jpeg;base64,${head}${"A".repeat(Math.max(0, chars - head.length))}`;
}
