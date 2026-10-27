import { afterEach, describe, expect, it, vi } from "vitest";
import { PEERS_CHANNEL, PEERS_TOAST, watchPeers } from "../../peers";
import { clearToasts } from "../../toasts";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// F106: two tools pages of one game, and so of one save, see each other
// ─────────────────────────────────────────────────────────────────────────────

/** The cleanups of a test: each page's channel, and its toast timers. */
const stops: (() => void)[] = [];

/**
 * Opens one tools page's watch.
 *
 * @returns The page's workspace context.
 */
function page(): ReturnType<typeof createCtx> {
  const ctx = createCtx();
  const close = watchPeers(ctx);
  stops.push(() => {
    close();
    clearToasts(ctx.state);
  });
  return ctx;
}

/**
 * The toast messages a page shows.
 *
 * @param ctx - The page's context.
 * @returns The messages.
 */
function toasts(ctx: ReturnType<typeof createCtx>): string[] {
  return ctx.state.toasts.map(toast => toast.message);
}

/**
 * Lets the channel deliver what was posted.
 *
 * @returns Resolves after the messages arrived.
 */
async function delivered(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20));
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllGlobals();
});

describe("watchPeers", () => {
  it("a second tools page makes both pages warn, once each (bug F106: a stale tab overwrote the save)", async () => {
    const first = page();
    await delivered();
    expect(toasts(first)).toEqual([]);

    const second = page();
    await delivered();

    expect(toasts(first)).toEqual([PEERS_TOAST]);
    expect(toasts(second)).toEqual([PEERS_TOAST]);
  });

  it("names a page it already knows only once", async () => {
    const first = page();
    page();
    await delivered();

    // The same page says hello again, as after a reload of its frame: no second toast.
    const other = new BroadcastChannel(PEERS_CHANNEL);
    stops.push(() => other.close());
    other.postMessage({ kind: "hello", id: "page-b" });
    other.postMessage({ kind: "hello", id: "page-b" });
    await delivered();

    expect(toasts(first)).toEqual([PEERS_TOAST, PEERS_TOAST]);
  });

  it("ignores a message of another shape", async () => {
    const first = page();
    const other = new BroadcastChannel(PEERS_CHANNEL);
    stops.push(() => other.close());
    other.postMessage({ kind: "bye", id: "page-b" });
    other.postMessage("hello");
    await delivered();

    expect(toasts(first)).toEqual([]);
  });

  it("watches nothing where BroadcastChannel is missing", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const ctx = createCtx();

    expect(() => watchPeers(ctx)()).not.toThrow();
    expect(toasts(ctx)).toEqual([]);
  });
});
