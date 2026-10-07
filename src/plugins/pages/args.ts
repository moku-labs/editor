/**
 * @file pages plugin — the arguments of `moku-editor [<game-html>] [--port 3000] [--root .]
 * [--no-hmr] [--preload FILE]… [--serve-plugin FILE]… [--help]` and of the subcommands
 * `moku-editor mcp [<game-html>] [--port N] [--root DIR] [--no-hmr]` and
 * `moku-editor mcp-config [<game-html>] [--port N]`. Without a game HTML file the bin serves the
 * engine page of a moku-game folder; `--preload` and `--serve-plugin` feed only that page. Pure:
 * no I/O. Unknown flags are errors (strict), so `--host` cannot exist: the server always binds
 * 127.0.0.1. `moku-editor e2e -c <playwright config> [playwright args…]` is the exception: only
 * its config is read, every other word belongs to Playwright.
 */
import { parseArgs } from "node:util";
import type { BinArgs } from "./types";

/**
 * The port when `--port` is not given to the serving bin.
 */
const DEFAULT_PORT = 3000;

/**
 * The highest TCP port.
 */
const PORT_MAX = 65_535;

/**
 * Why `mcp` and `mcp-config` refuse `--preload` and `--serve-plugin`.
 */
const SERVING_ONLY = "--preload and --serve-plugin belong to the serving bin";

/**
 * Why `e2e` is refused without its Playwright config.
 */
const E2E_NO_CONFIG = "e2e needs the Playwright config: -c <file>";

/**
 * The prefix of the joined config flag, `--config=<path>`.
 */
const CONFIG_JOINED = "--config=";

/**
 * Parses argv strictly with the six flags of the bin; `--preload` and `--serve-plugin` repeat.
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
      "no-hmr": { type: "boolean" },
      preload: { type: "string", multiple: true },
      "serve-plugin": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" }
    }
  });
}

/**
 * The parsed positionals and flag values.
 */
type Parsed = ReturnType<typeof parse>;

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
function tryParse(argv: readonly string[]): Parsed | string {
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
 * Whether argv has a `--preload` or a `--serve-plugin`: flags of the engine page only.
 *
 * @param values - The parsed flag values.
 * @returns True when either flag was given.
 * @example
 * ```ts
 * hasPageFlags(parse(["mcp", "--preload", "a.ts"]).values); // true
 * ```
 */
function hasPageFlags(values: Parsed["values"]): boolean {
  return values.preload !== undefined || values["serve-plugin"] !== undefined;
}

/**
 * The port of a `--port` value: digits only, 0-65535 (0 = a random free port).
 *
 * @param value - The flag value.
 * @returns The port, or undefined when the value is not a valid port.
 * @example
 * ```ts
 * portOf("0"); // 0
 * ```
 */
function portOf(value: string): number | undefined {
  if (!/^\d{1,5}$/.test(value)) return undefined;

  const port = Number(value);
  return port <= PORT_MAX ? port : undefined;
}

/**
 * Why a game HTML positional is refused, or undefined when it ends in `.html`.
 *
 * @param html - The positional.
 * @returns The problem, or undefined.
 * @example
 * ```ts
 * htmlProblem("web/index.ts"); // 'expected a game HTML file ending in .html, got "web/index.ts"'
 * ```
 */
function htmlProblem(html: string): string | undefined {
  if (html.toLowerCase().endsWith(".html")) return undefined;
  return `expected a game HTML file ending in .html, got "${html}"`;
}

/**
 * The optional html and port of a subcommand: at most one `.html` positional and an optional
 * `--port`. Absent values stay absent (the bridge reads them from the discovery file).
 *
 * @param positionals - The positionals after the subcommand.
 * @param port - The `--port` value, or undefined.
 * @returns The html and port that were given, or the problem.
 * @example
 * ```ts
 * optionalGame(["web/index.html"], "3000"); // { html: "web/index.html", port: 3000 }
 * ```
 */
function optionalGame(
  positionals: readonly string[],
  port: string | undefined
): { html?: string; port?: number } | string {
  const [html] = positionals;
  if (positionals.length > 1) return "expected at most one game HTML file";

  const problem = html === undefined ? undefined : htmlProblem(html);
  if (problem !== undefined) return problem;

  const parsedPort = port === undefined ? undefined : portOf(port);
  if (port !== undefined && parsedPort === undefined) return "--port must be an integer 0-65535";

  return {
    ...(html === undefined ? {} : { html }),
    ...(parsedPort === undefined ? {} : { port: parsedPort })
  };
}

/**
 * The arguments of `moku-editor mcp [<game-html>] [--port N] [--root DIR] [--no-hmr]`.
 *
 * @param parsed - The parsed argv; positionals[0] is "mcp".
 * @returns `mcp` args, or an error.
 * @example
 * ```ts
 * mcpArgs(parse(["mcp", "web/index.html"])); // { kind: "mcp", html: "web/index.html", root: ".", hmr: true }
 * ```
 */
function mcpArgs(parsed: Parsed): BinArgs {
  const { positionals, values } = parsed;
  if (hasPageFlags(values)) return failed(SERVING_ONLY);

  const game = optionalGame(positionals.slice(1), values.port);
  if (typeof game === "string") return failed(game);

  const root = values.root ?? ".";
  if (root === "") return failed("--root must not be empty");

  return { kind: "mcp", ...game, root, hmr: values["no-hmr"] !== true };
}

/**
 * The arguments of `moku-editor mcp-config [<game-html>] [--port N]`.
 *
 * @param parsed - The parsed argv; positionals[0] is "mcp-config".
 * @returns `mcp-config` args, or an error.
 * @example
 * ```ts
 * mcpConfigArgs(parse(["mcp-config", "-p", "3000"])); // { kind: "mcp-config", port: 3000 }
 * ```
 */
function mcpConfigArgs(parsed: Parsed): BinArgs {
  const { positionals, values } = parsed;
  if (hasPageFlags(values)) return failed(SERVING_ONLY);
  const hasServeFlags = values.root !== undefined || values["no-hmr"] !== undefined;
  if (hasServeFlags) return failed("mcp-config takes only <game-html> and --port");

  const game = optionalGame(positionals.slice(1), values.port);
  if (typeof game === "string") return failed(game);

  return { kind: "mcp-config", ...game };
}

/**
 * The arguments of the serving bin: at most one `.html` positional. Without it the engine writes
 * the page (no `html` key); with it, `--preload` and `--serve-plugin` are refused.
 *
 * @param parsed - The parsed argv.
 * @returns `run` args, or an error.
 * @example
 * ```ts
 * runArgs(parse(["web/index.html"])); // { kind: "run", html: "web/index.html", port: 3000, root: ".", hmr: true, preload: [], servePlugins: [] }
 * runArgs(parse(["--root", "games/timber"])); // { kind: "run", port: 3000, root: "games/timber", hmr: true, preload: [], servePlugins: [] }
 * ```
 */
function runArgs(parsed: Parsed): BinArgs {
  const { positionals, values } = parsed;

  // At most one positional, and it must be a `.html` file.
  const [html] = positionals;
  if (positionals.length > 1) return failed("expected at most one game HTML file");
  const problem = html === undefined ? undefined : htmlProblem(html);
  if (problem !== undefined) return failed(problem);

  // The page flags feed only the engine page, so an html file refuses them.
  const hasHtmlWithPageFlags = html !== undefined && hasPageFlags(values);
  if (hasHtmlWithPageFlags) {
    return failed("--preload and --serve-plugin need the engine page: drop the html file");
  }

  // The port defaults to 3000 and must be a valid TCP port.
  const port = values.port === undefined ? DEFAULT_PORT : portOf(values.port);
  if (port === undefined) return failed("--port must be an integer 0-65535");

  // The root defaults to the cwd and must not be empty.
  const root = values.root ?? ".";
  if (root === "") return failed("--root must not be empty");

  // The html key is left out for the engine page.
  return {
    kind: "run",
    ...(html === undefined ? {} : { html }),
    port,
    root,
    hmr: values["no-hmr"] !== true,
    preload: values.preload ?? [],
    servePlugins: values["serve-plugin"] ?? []
  };
}

/**
 * The arguments of `moku-editor e2e -c <playwright config> [playwright args…]`: the first `-c X`,
 * `--config X` or `--config=X` is the config; the other words stay, in order, for Playwright.
 *
 * @param words - The words after `e2e`.
 * @returns `e2e` args, or the error when the config is missing or empty.
 * @example
 * ```ts
 * e2eArgs(["--config=a.ts", "-g", "pick"]); // { kind: "e2e", config: "a.ts", rest: ["-g", "pick"] }
 * e2eArgs(["-g", "pick"]); // { kind: "error", message: "[moku-editor] e2e needs the Playwright config: -c <file>" }
 * ```
 */
function e2eArgs(words: readonly string[]): BinArgs {
  const at = words.findIndex(
    word => word === "-c" || word === "--config" || word.startsWith(CONFIG_JOINED)
  );
  const flag = at === -1 ? undefined : words[at];
  if (flag === undefined) return failed(E2E_NO_CONFIG);

  // `--config=X` is one word; `-c X` and `--config X` take the next word too.
  const isJoined = flag.startsWith(CONFIG_JOINED);
  const config = isJoined ? flag.slice(CONFIG_JOINED.length) : words[at + 1];
  if (config === undefined || config === "") return failed(E2E_NO_CONFIG);

  const taken = isJoined ? 1 : 2;
  const rest = [...words.slice(0, at), ...words.slice(at + taken)];
  return { kind: "e2e", config, rest };
}

/**
 * Parses the bin arguments. A first word `e2e` picks that subcommand before anything else (its
 * words belong to Playwright, `--help` too); a first positional `mcp` or `mcp-config` picks that
 * subcommand.
 *
 * @param argv - Arguments after the script name.
 * @returns `run` with html (left out for the engine page), port, root, hmr, preload and
 * servePlugins; `mcp`; `mcp-config`; `e2e` with the config and Playwright's words; `help`; or
 * `error` with a message.
 * @example
 * ```ts
 * parseBinArgs(["web/index.html", "--port", "0"]); // { kind: "run", html: "web/index.html", port: 0, root: ".", hmr: true, preload: [], servePlugins: [] }
 * parseBinArgs(["--root", "games/timber"]); // { kind: "run", port: 3000, root: "games/timber", hmr: true, preload: [], servePlugins: [] }
 * parseBinArgs(["mcp", "web/index.html"]); // { kind: "mcp", html: "web/index.html", root: ".", hmr: true }
 * parseBinArgs(["e2e", "-c", "pw.config.ts", "--headed"]); // { kind: "e2e", config: "pw.config.ts", rest: ["--headed"] }
 * ```
 */
export function parseBinArgs(argv: readonly string[]): BinArgs {
  if (argv[0] === "e2e") return e2eArgs(argv.slice(1));
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };

  const parsed = tryParse(argv);
  if (typeof parsed === "string") return failed(parsed);

  const [subcommand] = parsed.positionals;
  if (subcommand === "mcp") return mcpArgs(parsed);
  if (subcommand === "mcp-config") return mcpConfigArgs(parsed);
  return runArgs(parsed);
}
