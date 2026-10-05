import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBridge } from "../../../mcp/bridge";
import type { BridgeDeps } from "../../../mcp/types";
import { VERSION } from "../../../mcp/version";
import discoverProbe from "../../fixtures/claude-discover-probe.json";
import initialize from "../../fixtures/claude-initialize.json";

// ─────────────────────────────────────────────────────────────────────────────
// The handshake of the installed Claude Code (2.1.280), recorded from its
// stdin by `claude mcp list` (fixtures/claude-*.json): it probes
// `server/discover` of the next protocol first, falls back to `initialize`
// 2025-11-25 with id 0 on -32601, then sends notifications/initialized and
// tools/list. The bridge answers each the way the client needs.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-mcp-claude-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** One frame the bridge wrote. */
type Frame = {
  readonly id?: string | number | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
};

/**
 * Runs the bridge over the given stdin lines, without a bin, and answers its frames.
 *
 * @param messages - What the client sends, in order; stdin ends after the last.
 * @returns The exit code and the parsed frames.
 */
async function replay(messages: readonly object[]): Promise<{ code: number; frames: Frame[] }> {
  const writes: string[] = [];
  /**
   * Yields every message as one line.
   *
   * @yields {string} One JSON-RPC line.
   */
  async function* lines(): AsyncGenerator<string> {
    for (const message of messages) yield `${JSON.stringify(message)}\n`;
  }
  const deps: BridgeDeps = {
    input: lines(),
    write: text => writes.push(text),
    ui: createBrandConsole({ write: vi.fn(), writeError: vi.fn(), color: false }),
    spawn: vi.fn(),
    isAlive: () => false,
    command: ["bun", "bin.mjs"],
    now: Date.now,
    onSignal: () => vi.fn(),
    releaseInput: vi.fn()
  };
  const code = await runBridge({ kind: "mcp", root, hmr: true }, deps);
  return { code, frames: writes.map(text => JSON.parse(text)) };
}

describe("the Claude Code 2.1.280 handshake", () => {
  it("answers its recorded initialize (id 0) with 2025-11-25, the tools capability and moku-editor", async () => {
    const { code, frames } = await replay([initialize]);

    expect(code).toBe(0);
    expect(frames).toEqual([
      {
        jsonrpc: "2.0",
        id: 0,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: true }, logging: {} },
          serverInfo: { name: "moku-editor", version: VERSION }
        }
      }
    ]);
  });

  it("refuses the server/discover probe with -32601 so the client falls back to initialize", async () => {
    const { frames } = await replay([
      discoverProbe,
      initialize,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { method: "tools/list", jsonrpc: "2.0", id: 1 }
    ]);

    expect(frames[0]).toEqual({
      jsonrpc: "2.0",
      id: "server-discover-probe-1",
      error: { code: -32_601, message: "method not found: server/discover" }
    });
    expect(frames[1]).toMatchObject({ id: 0, result: { protocolVersion: "2025-11-25" } });
    expect(frames[2]?.id).toBe(1);
    expect(frames[2]?.result?.tools).toHaveLength(17);
    expect(frames).toHaveLength(3);
  });
});
