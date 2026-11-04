/**
 * @file pages plugin — the phone a run may reach by wire (E13): `--device <serial>`, else
 * `ANDROID_SERIAL`. Nothing else chooses a phone, so a run without either reverses none. Pure.
 */

/** A serial as adb prints it: USB, `ip:port`, or an `_adb-tls-connect` mDNS name (connect's rule). */
const SERIAL = /^[\w.:-]{1,96}$/;

/** The message of a `--device` that is not an adb serial. */
export const DEVICE_ERROR =
  "--device must be a serial adb devices prints.\n  Run moku-editor --device R5CX1234.";

/**
 * The `device` key of parsed arguments: left out without the flag, the error text for a value
 * that is not an adb serial.
 *
 * @param value - The `--device` value, or undefined.
 * @returns The key to spread, or the error text.
 * @example
 * ```ts
 * deviceKey("R5CX1234"); // { device: "R5CX1234" }
 * deviceKey(undefined); // {}
 * deviceKey("R5; rm"); // DEVICE_ERROR
 * ```
 */
export function deviceKey(value: string | undefined): { device?: string } | string {
  if (value === undefined) return {};
  return SERIAL.test(value) ? { device: value } : DEVICE_ERROR;
}

/**
 * Arguments with their phone: `--device` wins, else a non-empty `ANDROID_SERIAL`; arguments of
 * any other kind, or with neither, come back as they are.
 *
 * @param args - Parsed arguments.
 * @param env - The environment.
 * @returns The arguments, with `device` when one was chosen.
 * @example
 * ```ts
 * withDevice({ kind: "perf", lan: false, port: 47600, out: ".moku/perf", every: 10, ui: true }, { ANDROID_SERIAL: "R5" });
 * // { ..., device: "R5" }
 * ```
 */
export function withDevice<Args extends { readonly kind: string; readonly device?: string }>(
  args: Args,
  env: Readonly<Record<string, string | undefined>>
): Args {
  const takesDevice = args.kind === "run" || args.kind === "mcp" || args.kind === "perf";
  const serial = env.ANDROID_SERIAL?.trim() ?? "";
  const fromEnvironment = takesDevice && args.device === undefined && serial !== "";
  return fromEnvironment ? { ...args, device: serial } : args;
}
