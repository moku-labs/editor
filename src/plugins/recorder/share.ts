/**
 * @file recorder plugin — share: the native share sheet when the shell offers it
 * (`__MOKU_NATIVE__` v1 with `share`, debug builds of `@moku-labs/native`), else a download link
 * (a browser page; a WebView ignores it), else an error. The current log is written to the store
 * first; the status shows `exporting` meanwhile.
 */
import { MEGABYTE, persistAll, warnFailure } from "./flush";
import { unknownLog } from "./session";
import { emitStatus, filesOf, findFile, readLog } from "./state";
import { NDJSON } from "./store";
import type { RecorderCtx, RecorderState, ShareResult } from "./types";

/** The most bytes the native shell's share takes (@moku-labs/native: "≤ 32 MiB"). */
export const NATIVE_SHARE_MAX_BYTES = 32 * MEGABYTE;

/** How long a download URL stays valid after the click, ms. */
const REVOKE_AFTER_MS = 30_000;

/** The message of a page that can share nothing. */
const NO_SHARE =
  "[moku-editor] recorder.share needs a page with a document or a native shell with share().\n  Share the log from a browser page or a native build.";

/** Hands a log's blob to the user. */
type Deliver = (name: string, blob: Blob) => Promise<ShareResult>;

/**
 * The share sheet of the native shell: `__MOKU_NATIVE__` of version 1 with a function `share`. A
 * log over 32 MiB is refused before the shell is called (the shell rejects it).
 *
 * @returns The delivery through it; undefined without one.
 */
function nativeDelivery(): Deliver | undefined {
  const shell: unknown = Reflect.get(globalThis, "__MOKU_NATIVE__");
  if (typeof shell !== "object" || shell === null || Reflect.get(shell, "version") !== 1) {
    return undefined;
  }
  const share: unknown = Reflect.get(shell, "share");
  if (typeof share !== "function") return undefined;
  return async (name, blob) => {
    if (blob.size > NATIVE_SHARE_MAX_BYTES) {
      const megabytes = (blob.size / MEGABYTE).toFixed(1);
      throw new Error(
        `[moku-editor] recorder.share: ${name} is ${megabytes} MB, more than the 32 MB a native share takes.\n  Pull it with the collector over adb (moku-editor perf), or share shorter logs.`
      );
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const answer: unknown = await Reflect.apply(share, shell, [{ name, mime: NDJSON, bytes }]);
    return Reflect.get(Object(answer), "shared") === true ? "shared" : "cancelled";
  };
}

/**
 * A download link on the page: an `<a download>` on an object URL, clicked, the URL revoked later
 * (the timer is kept in `revokes`, so onStop revokes it at once).
 *
 * @param state - The recorder's state.
 * @param page - The page's document.
 * @returns The delivery.
 */
function downloadDelivery(state: RecorderState, page: Document): Deliver {
  return async (name, blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = page.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    page.body.append(anchor);
    anchor.click();
    anchor.remove();
    const timer = setTimeout(() => {
      state.revokes.delete(timer);
      URL.revokeObjectURL(url);
    }, REVOKE_AFTER_MS);
    state.revokes.set(timer, url);
    return "downloaded";
  };
}

/**
 * The way this page hands a file to the user.
 *
 * @param state - The recorder's state.
 * @returns The native share, else a download link; undefined on a page with neither.
 */
function deliveryOf(state: RecorderState): Deliver | undefined {
  const native = nativeDelivery();
  if (native !== undefined) return native;
  return typeof document === "undefined" ? undefined : downloadDelivery(state, document);
}

/**
 * Revokes every download URL whose timer still runs, and clears the timers (onStop).
 *
 * @param state - The recorder's state.
 */
export function revokeDownloads(state: RecorderState): void {
  for (const [timer, url] of state.revokes) {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
  state.revokes.clear();
}

/**
 * Shares a log: the current log's pending text written first, the status `exporting` while any share
 * runs, a `recorder` export event, the whole log handed over, the phase back when the last share
 * ends (also on a failure).
 *
 * @param ctx - The recorder's context.
 * @param name - The log's name.
 * @returns What the share did.
 * @throws {TypeError} For an unknown name.
 * @throws {Error} When the page has neither a document nor a native share.
 */
export async function shareLog(ctx: RecorderCtx, name: string): Promise<ShareResult> {
  const { state } = ctx;
  const known = findFile(state, name);
  if (known === undefined) throw new TypeError(unknownLog("recorder.share", name));
  const deliver = deliveryOf(state);
  if (deliver === undefined) throw new Error(NO_SHARE);

  const { session } = state;
  if (session?.name === name) warnFailure(ctx, name, await persistAll(state, session));
  state.exports += 1;
  state.phase = "exporting";
  emitStatus(ctx, true);
  state.monitor?.event("recorder", { action: "export" });
  try {
    // The current log may have moved to memory while it was written.
    const info = filesOf(state).find(file => file.name === name) ?? known;
    const how = await deliver(name, await readLog(state, info));
    ctx.log.info("recorder:shared", { file: name, how });
    return how;
  } finally {
    // The last share in flight sets the phase back: recording while a log runs, else idle.
    state.exports -= 1;
    if (state.exports === 0) state.phase = state.session === undefined ? "idle" : "recording";
    emitStatus(ctx, true);
  }
}
