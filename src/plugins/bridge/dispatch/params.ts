/**
 * @file bridge plugin — the params of the five game-channel methods, their check (checkInput plus
 * the SubId rule, R6) and the deadline of a request (R1 long calls).
 */
import type { InputOf, InputSchema, Json } from "../../registry/protocol";
import { checkInput, errorCode, wireError } from "../../registry/protocol";
import { DEADLINE_EXTRA_CAP_MS, SERIES_ID, SHEET_ID } from "../types";

/**
 * The params schema of each game-channel method.
 *
 * @example
 * ```ts
 * checkInput(PARAMS.read, { id: "game.position" }); // { id: "game.position" }
 * ```
 */
export const PARAMS = {
  manifest: {},
  read: { id: "string", input: "json?" },
  watch: { sub: "number", id: "string", input: "json?" },
  unwatch: { sub: "number" },
  run: { id: "string", input: "json?" }
} as const satisfies Record<string, InputSchema>;

/**
 * The checked params of a method.
 *
 * @example
 * ```ts
 * const watch: CheckedParams<"watch"> = { sub: 1, id: "game.position" };
 * ```
 */
export type CheckedParams<M extends keyof typeof PARAMS> = InputOf<(typeof PARAMS)[M]>;

/**
 * The raw params of a request that carries none.
 */
// eslint-disable-next-line unicorn/no-null -- null is the wire value for "no params" (checkInput)
const NO_PARAMS: Json = null;

/**
 * A member of a JSON object, or undefined for anything else.
 *
 * @param value - A JSON value.
 * @param key - The member name.
 * @returns The member.
 * @example
 * ```ts
 * memberOf({ id: "game.step" }, "id"); // "game.step"
 * ```
 */
export function memberOf(value: Json | undefined, key: string): Json | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value[key];
}

/**
 * Rejects a `sub` that is a number but not a safe integer ≥ 0 (R6).
 *
 * @param params - The raw params, already checked by checkInput.
 * @throws {Error} -32602 `invalid_input` with field `sub`.
 * @example
 * ```ts
 * checkSub({ sub: 1.5, id: "game.position" }); // throws
 * ```
 */
function checkSub(params: Json | undefined): void {
  const sub = memberOf(params, "sub");
  if (typeof sub !== "number" || (Number.isSafeInteger(sub) && sub >= 0)) return;
  throw wireError(errorCode.invalidInput, "sub must be a whole number of at least 0", {
    reason: "invalid_input",
    retryable: false,
    field: "sub"
  });
}

/**
 * Checks the params of a game-channel method: checkInput against PARAMS (unknown fields
 * rejected), then the SubId rule for `watch` and `unwatch`.
 *
 * @param method - The method.
 * @param params - The raw params (`undefined` = none).
 * @returns The checked params.
 * @throws {Error} -32602 `invalid_input` naming the field.
 * @example
 * ```ts
 * const { sub, id, input } = checkParams("watch", request.params);
 * ```
 */
export function checkParams<M extends keyof typeof PARAMS>(
  method: M,
  params: Json | undefined
): CheckedParams<M> {
  const checked = checkInput(PARAMS[method], params ?? NO_PARAMS);
  checkSub(params);
  return checked;
}

/**
 * A length in ms or a count: a finite number ≥ 0, else 0.
 *
 * @param value - A Json member.
 * @returns The number, or 0.
 * @example
 * ```ts
 * lengthOf(500); // 500
 * lengthOf(-1); // 0
 * ```
 */
function lengthOf(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The extra wait of a long run (R1): input.durationMs of `editor.series`, input.frames ×
 * input.everyMs of `editor.sheet`; 0 for every other request or a bad value.
 *
 * @param method - The method.
 * @param params - The raw params.
 * @returns The extra wait in milliseconds, not capped.
 * @example
 * ```ts
 * longCallMs("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }); // 3000
 * ```
 */
function longCallMs(method: string, params: Json | undefined): number {
  if (method !== "run") return 0;

  const id = memberOf(params, "id");
  const input = memberOf(params, "input");
  if (id === SERIES_ID) return lengthOf(memberOf(input, "durationMs"));
  if (id === SHEET_ID) {
    return lengthOf(memberOf(input, "frames")) * lengthOf(memberOf(input, "everyMs"));
  }
  return 0;
}

/**
 * The deadline of a request: callTimeoutMs, plus the long-call extension capped at 60 s for `run`
 * of `editor.series` (input.durationMs) or `editor.sheet` (input.frames × input.everyMs) (R1: the
 * same rule in bridge, hub, link).
 *
 * @param method - The method.
 * @param params - The raw params.
 * @param callTimeoutMs - config.callTimeoutMs.
 * @returns The deadline in milliseconds.
 * @example
 * ```ts
 * deadlineFor("run", { id: "editor.series", input: { durationMs: 20_000 } }, 5000); // 25000
 * deadlineFor("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }, 5000); // 8000
 * ```
 */
export function deadlineFor(
  method: string,
  params: Json | undefined,
  callTimeoutMs: number
): number {
  return callTimeoutMs + Math.min(longCallMs(method, params), DEADLINE_EXTRA_CAP_MS);
}
