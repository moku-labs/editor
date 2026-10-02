/**
 * @file pages plugin — the moku-editor bin program: parse arguments, import the game HTML at run
 * time, start the server core, Bun.serve(hub.serve(...)), print the URLs through the branded
 * console (MC1). The token is never printed.
 */

/**
 * Runs the bin; resolves with the exit code (0 help or serving, 1 runtime error, 2 bad arguments).
 *
 * @param _argv - Arguments after the script name.
 * @example
 * ```ts
 * process.exitCode = await main(Bun.argv.slice(2));
 * ```
 */
export function main(_argv: readonly string[]): Promise<number> {
  throw new Error("not implemented");
}
