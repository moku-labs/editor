/**
 * @file pages plugin — the arguments of `moku-editor <game-html> [--port 3000] [--root .]
 * [--help]`. Pure: no I/O. Unknown flags are errors (strict), so `--host` cannot exist: the server
 * always binds 127.0.0.1.
 */
import { parseArgs } from "node:util";
import type { BinArgs } from "./types";

/**
 * The port when `--port` is not given.
 */
const DEFAULT_PORT = 3000;

/**
 * The highest TCP port.
 */
const PORT_MAX = 65_535;

/**
 * Parses argv strictly with the three flags of the bin.
 *
 * @param argv - Arguments after the script name.
 * @returns The positionals and flag values.
 * @throws {Error} On an unknown flag or a flag without its value.
 * @example
 * ```ts
 * parse(["web/index.html", "-p", "0"]).values.port; // "0"
 * ```
 */
function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      port: { type: "string", short: "p" },
      root: { type: "string", short: "r" },
      help: { type: "boolean", short: "h" }
    }
  });
}

/**
 * The parse result, or the parser's message.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments, or the error message.
 * @example
 * ```ts
 * typeof tryParse(["--host", "x"]); // "string"
 * ```
 */
function tryParse(argv: readonly string[]): ReturnType<typeof parse> | string {
  try {
    return parse(argv);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * An error result with the editor prefix (R7).
 *
 * @param message - What is wrong.
 * @returns The error result.
 * @example
 * ```ts
 * return failed("expected one game HTML file");
 * ```
 */
function failed(message: string): BinArgs {
  return { kind: "error", message: `[moku-editor] ${message}` };
}

/**
 * The port of a `--port` value: digits only, 0-65535 (0 = a random free port).
 *
 * @param value - The flag value, or undefined.
 * @returns The port, or undefined when the value is not a valid port.
 * @example
 * ```ts
 * portOf("0"); // 0
 * ```
 */
function portOf(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(value)) return undefined;

  const port = Number(value);
  return port <= PORT_MAX ? port : undefined;
}

/**
 * Parses the bin arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns `run` with html, port and root; `help`; or `error` with a message.
 * @example
 * ```ts
 * parseBinArgs(["web/index.html", "--port", "0"]); // { kind: "run", html: "web/index.html", port: 0, root: "." }
 * ```
 */
export function parseBinArgs(argv: readonly string[]): BinArgs {
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };

  const parsed = tryParse(argv);
  if (typeof parsed === "string") return failed(parsed);

  const { positionals, values } = parsed;
  const [html] = positionals;
  if (positionals.length !== 1 || html === undefined) return failed("expected one game HTML file");
  if (!html.toLowerCase().endsWith(".html")) {
    return failed(`expected a game HTML file ending in .html, got "${html}"`);
  }

  const port = portOf(values.port);
  if (port === undefined) return failed("--port must be an integer 0-65535");

  const root = values.root ?? ".";
  if (root === "") return failed("--root must not be empty");

  return { kind: "run", html, port, root };
}
