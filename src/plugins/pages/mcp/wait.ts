/**
 * @file pages/mcp — moku_wait (M5): a hub `watch` that resolves when the value deep-equals
 * `until`, or differs from `changedFrom` (default: the first change after the current value), or
 * times out with the last value. The watch is always unwatched; a cancelled request ends it too.
 * Frame sources change at most once per heartbeat (about 1 s, D-15).
 */
import type { Json } from "../../registry/protocol";
import { isObject } from "./rpc";
import type { HubClient, ToolCall, WatchTarget } from "./types";

/**
 * How the wait ended: matched or timed out, the last value and the time it took.
 */
export type WaitOutcome = {
  readonly timedOut: boolean;
  readonly value: Json | undefined;
  readonly waitedMs: number;
};

/**
 * When a wait is satisfied: `until` (deep-equal), `changedFrom` (differs), or neither (the
 * first change after the current value).
 */
export type WaitRule =
  | { readonly kind: "until"; readonly value: Json }
  | { readonly kind: "changedFrom"; readonly value: Json }
  | { readonly kind: "change" };

/**
 * True when two JSON values are equal, whatever the order of object keys.
 *
 * @param left - A value.
 * @param right - Another value.
 * @returns Whether they are deep-equal.
 * @example
 * ```ts
 * jsonEqual({ a: 1, b: [2] }, { b: [2], a: 1 }); // true
 * ```
 */
export function jsonEqual(left: Json, right: Json): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => {
      const other = right[index];
      return other !== undefined && jsonEqual(item, other);
    });
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every(key => {
      const [mine, theirs] = [left[key], right[key]];
      return mine !== undefined && theirs !== undefined && jsonEqual(mine, theirs);
    });
  }
  return left === right;
}

/**
 * The value test of a rule. The `change` rule takes the first value as its baseline.
 *
 * @param rule - The rule.
 * @returns A test called with every value in order.
 * @example
 * ```ts
 * const matches = matcherOf({ kind: "until", value: "board" });
 * matches("splash"); // false
 * ```
 */
export function matcherOf(rule: WaitRule): (value: Json) => boolean {
  if (rule.kind === "until") return value => jsonEqual(value, rule.value);
  if (rule.kind === "changedFrom") return value => !jsonEqual(value, rule.value);

  let baseline: { readonly value: Json } | undefined;
  return value => {
    if (baseline === undefined) {
      baseline = { value };
      return false;
    }
    return !jsonEqual(value, baseline.value);
  };
}

/**
 * Watches a source until the rule matches, the time is up or the request is cancelled; the watch
 * is stopped in every case. Progress is reported every second.
 *
 * @param hub - The hub connection.
 * @param target - The source, its input and the session.
 * @param rule - When the wait is satisfied.
 * @param options - The timeout, the tool call (signal and progress) and the clock.
 * @param options.timeoutMs - The longest wait.
 * @param options.call - The tool call.
 * @param options.now - Epoch ms.
 * @returns How the wait ended.
 * @throws {Error} The hub's error when the watch is refused (unknown id, no session …).
 * @example
 * ```ts
 * await waitForValue(hub, { id: "game.position", input: undefined, session: undefined }, { kind: "change" }, { timeoutMs: 10_000, call, now: Date.now });
 * // { timedOut: false, value: { path: "board/awaitIntent", … }, waitedMs: 2140 }
 * ```
 */
export function waitForValue(
  hub: HubClient,
  target: WatchTarget,
  rule: WaitRule,
  options: { readonly timeoutMs: number; readonly call: ToolCall; readonly now: () => number }
): Promise<WaitOutcome> {
  const { timeoutMs, call, now } = options;
  const startedAt = now();
  const matches = matcherOf(rule);

  return new Promise<WaitOutcome>((resolve, reject) => {
    let last: Json | undefined;
    let stop: (() => void) | undefined;
    let done = false;
    const finish = (timedOut: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(ticker);
      call.signal.removeEventListener("abort", onAbort);
      stop?.();
      resolve({ timedOut, value: last, waitedMs: now() - startedAt });
    };
    const onAbort = (): void => finish(true);
    const timer = setTimeout(() => finish(true), timeoutMs);
    const ticker = setInterval(() => call.progress(now() - startedAt, timeoutMs), 1000);
    call.signal.addEventListener("abort", onAbort, { once: true });

    hub
      .watch(target, value => {
        last = value;
        if (matches(value)) finish(false);
      })
      .then(
        unwatch => {
          stop = unwatch;
          if (done) unwatch();
        },
        (error: unknown) => {
          done = true;
          clearTimeout(timer);
          clearInterval(ticker);
          call.signal.removeEventListener("abort", onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
  });
}
