/**
 * @file connect plugin — the one process seam (spec 11 C7): `runAdb` spawns adb (connect's own copy
 * of the collector's shape: stdout piped, stderr ignored, killed after a timeout, code 127 and
 * `missing` when adb cannot be spawned, never rejects), and `adb` is the only caller of the runner:
 * it takes an allowlisted AdbCommand, never an argv, and removes only forwards connect made.
 */
import type { AdbCommand, AdbResult, ConnectCore } from "../types";
import { adbArgs, refused } from "./command";

/** The code of a command that cannot be spawned (a shell's "not found"). */
const NOT_FOUND = 127;

/** The code of a command killed after the timeout, or one that failed to spawn otherwise. */
const NO_CODE = -1;

/** What a killed or unspawnable command answers. */
const NO_ANSWER: AdbResult = { code: NO_CODE, text: "", missing: false };

/**
 * Whether a spawn error means the command does not exist.
 *
 * @param error - What Bun.spawn threw.
 * @returns Whether it is ENOENT.
 * @example
 * ```ts
 * isMissing(Object.assign(new Error("Executable not found"), { code: "ENOENT" })); // true
 * ```
 */
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Runs one adb command (`Bun.spawn`, stdout piped, stderr ignored). Never rejects.
 *
 * @param command - The adb command (a name on PATH or a path).
 * @param args - Its arguments, built by `adbArgs`.
 * @param timeoutMs - The longest it may run before it is killed.
 * @returns The exit code and output; code −1 and no text when it was killed; code 127 and
 * `missing` when the command does not exist.
 */
export async function runAdb(
  command: string,
  args: readonly string[],
  timeoutMs: number
): Promise<AdbResult> {
  let child: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    child = Bun.spawn([command, ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch (error) {
    return isMissing(error) ? { code: NOT_FOUND, text: "", missing: true } : NO_ANSWER;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const killed = new Promise<AdbResult>(resolve => {
    timer = setTimeout(() => {
      child.kill();
      resolve(NO_ANSWER);
    }, timeoutMs);
  });
  const finished = Promise.all([new Response(child.stdout).text(), child.exited]).then(
    ([text, code]): AdbResult => ({ code, text, missing: false }),
    (): AdbResult => NO_ANSWER
  );

  try {
    return await Promise.race([finished, killed]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one allowlisted adb command through the state's runner. A forward removal must name a port
 * connect recorded for that serial.
 *
 * @param ctx - The config (adb command, timeout) and the state (runner, recorded forwards).
 * @param command - The command.
 * @returns What adb answered.
 * @throws {TypeError} A refused token (see `adbArgs`), or a forward connect did not make.
 */
export async function adb(ctx: ConnectCore, command: AdbCommand): Promise<AdbResult> {
  if (
    command.kind === "forward-remove" &&
    ctx.state.forwards.get(command.port) !== command.serial
  ) {
    throw refused(String(command.port));
  }
  return ctx.state.deps.run(ctx.config.adb, adbArgs(command), ctx.config.adbTimeoutMs);
}
