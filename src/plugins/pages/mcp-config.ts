/**
 * @file pages plugin — `moku-editor mcp-config` (M8): the `.mcp.json` snippet and the
 * `claude mcp add` line that start the stdio MCP bridge with the same arguments. Pure: no I/O.
 */
import type { McpConfigArgs } from "./types";

/**
 * The name Claude Code knows the server by.
 */
const SERVER_NAME = "moku-editor";

/**
 * A word the shell reads as is, without quotes.
 */
const PLAIN_WORD = /^[\w./:@%+=,-]+$/;

/**
 * The command words after `bunx`: `moku-editor mcp [<html>] [--port N]`.
 *
 * @param args - The `mcp-config` arguments.
 * @returns The words.
 * @example
 * ```ts
 * bridgeWords({ kind: "mcp-config", port: 3000 }); // ["moku-editor", "mcp", "--port", "3000"]
 * ```
 */
function bridgeWords(args: McpConfigArgs): string[] {
  return [
    "moku-editor",
    "mcp",
    ...(args.html === undefined ? [] : [args.html]),
    ...(args.port === undefined ? [] : ["--port", String(args.port)])
  ];
}

/**
 * One word for a POSIX shell: as is when plain, else single-quoted.
 *
 * @param word - The word.
 * @returns The quoted word.
 * @example
 * ```ts
 * shellWord("my game/index.html"); // "'my game/index.html'"
 * ```
 */
function shellWord(word: string): string {
  if (PLAIN_WORD.test(word)) return word;
  const escaped = word.replaceAll("'", String.raw`'\''`);
  return `'${escaped}'`;
}

/**
 * The printed lines: the `.mcp.json` snippet, a blank line, then the `claude mcp add` line.
 *
 * @param args - The `mcp-config` arguments.
 * @returns The lines, in order.
 * @example
 * ```ts
 * mcpConfigLines({ kind: "mcp-config", html: "web/index.html", port: 3000 }).at(-1);
 * // "claude mcp add moku-editor -- bunx moku-editor mcp web/index.html --port 3000"
 * ```
 */
export function mcpConfigLines(args: McpConfigArgs): string[] {
  const words = bridgeWords(args);
  const snippet = {
    mcpServers: { [SERVER_NAME]: { type: "stdio", command: "bunx", args: words } }
  };
  const command = [
    "claude",
    "mcp",
    "add",
    SERVER_NAME,
    "--",
    "bunx",
    ...words.map(word => shellWord(word))
  ];

  return [...JSON.stringify(snippet, undefined, 2).split("\n"), "", command.join(" ")];
}
