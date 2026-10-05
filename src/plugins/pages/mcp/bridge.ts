/**
 * @file pages/mcp — `moku-editor mcp` (D-31): the stdio MCP server Claude Code starts. It reads
 * newline-delimited JSON-RPC from stdin, answers on stdout (protocol frames only; logs go to
 * stderr), connects to the running bin's hub as a tools client or starts the bin, and on stdin
 * end aborts pending calls, closes the socket and stops a bin it started. Exit code 0.
 */
import { resolve } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import type { McpArgs } from "../types";
import { createEditorLink } from "./connection";
import { isProcessAlive } from "./discovery";
import { spawnDetached } from "./launcher";
import { frameText, readLines } from "./rpc";
import { createMcpServer } from "./server";
import { TOOLS } from "./tools";
import type { BridgeDeps } from "./types";
import { VERSION } from "./version";

/**
 * How long the stdin end waits for requests in flight before it tears down.
 */
const SETTLE_MS = 2000;

/**
 * Does nothing (the tools-changed callback until the server exists).
 */
function noop(): void {
  // Replaced once the server exists.
}

/**
 * Writes one line to stderr.
 *
 * @param line - The line.
 */
function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * The deps of the real process: stdin, stdout for frames only, a branded console on stderr, the
 * detached spawn of the bin and this runtime with this bin script.
 *
 * @returns The bridge deps.
 * @example
 * ```ts
 * process.exitCode = await runBridge(args, processBridgeDeps());
 * ```
 */
export function processBridgeDeps(): BridgeDeps {
  return {
    input: process.stdin,
    write: text => {
      process.stdout.write(text);
    },
    ui: createBrandConsole({ write: writeStderr, writeError: writeStderr, color: false }),
    spawn: spawnDetached,
    isAlive: isProcessAlive,
    command: [process.execPath, Bun.main],
    now: Date.now
  };
}

/**
 * Waits for a promise, at most `ms`.
 *
 * @param work - The promise.
 * @param ms - The longest wait.
 * @returns Resolves when the work settled or the time is up.
 * @example
 * ```ts
 * await settleWithin(server.idle(), 2000);
 * ```
 */
async function settleWithin(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(done => {
    timer = setTimeout(done, ms);
  });
  await Promise.race([work, deadline]);
  clearTimeout(timer);
}

/**
 * Runs the stdio MCP bridge until stdin ends.
 *
 * @param args - The `mcp` arguments: optional html and port for the launcher, root, hot reload.
 * @param deps - stdio, console and process seams (default: this process).
 * @returns The exit code: 0.
 * @example
 * ```ts
 * // cli.ts, `moku-editor mcp web/index.html --port 3000`
 * return { code: await runBridge({ kind: "mcp", html: "web/index.html", port: 3000, root: ".", hmr: true }) };
 * ```
 */
export async function runBridge(
  args: McpArgs,
  deps: BridgeDeps = processBridgeDeps()
): Promise<number> {
  const root = resolve(args.root);
  let toolsChanged: () => void = noop;
  const editor = createEditorLink({ root, args, deps, onBinChanged: () => toolsChanged() });
  const server = createMcpServer({
    send: frame => deps.write(frameText(frame)),
    tools: TOOLS,
    context: { editor, now: deps.now },
    version: VERSION
  });
  toolsChanged = () => server.toolsChanged();

  deps.ui.info(`moku-editor mcp ${VERSION}: stdio MCP server for ${root}`);
  // The startup never rejects; shutdown waits for it (and cancels a bin start in progress).
  editor.start();
  await readLines(deps.input, line => server.handleLine(line));

  server.cancelAll();
  await settleWithin(server.idle(), SETTLE_MS);
  await editor.shutdown();
  deps.ui.info("moku-editor mcp: stdin closed");
  return 0;
}
