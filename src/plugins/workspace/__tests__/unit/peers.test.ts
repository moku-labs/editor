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
 * Lets the channel deliver what was posted, for a test that expects nothing to happen.
 *
 * @returns Resolves after the messages arrived.
 */
async function delivered(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 50));
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

    await vi.waitFor(() => {
      expect(toasts(first)).toEqual([PEERS_TOAST]);
      expect(toasts(second)).toEqual([PEERS_TOAST]);
    });
  });

  it("a second hello of a page it knows adds no toast", async () => {
    const first = page();
    const other = new BroadcastChannel(PEERS_CHANNEL);
    stops.push(() => other.close());

    // page-b says hello twice: one toast for it.
    other.postMessage({ kind: "hello", id: "page-b" });
    other.postMessage({ kind: "hello", id: "page-b" });
    await vi.waitFor(() => expect(toasts(first)).toEqual([PEERS_TOAST]));
    await delivered();

    expect(toasts(first)).toEqual([PEERS_TOAST]);
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

  it("works on a page that is no secure context, where randomUUID is missing (bug: onStart threw on a LAN address)", async () => {
    const { getRandomValues } = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: getRandomValues.bind(globalThis.crypto) });
    const first = page();
    page();

    await vi.waitFor(() => expect(toasts(first)).toEqual([PEERS_TOAST]));
  });

  it("watches nothing where BroadcastChannel is missing", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const ctx = createCtx();

    expect(() => watchPeers(ctx)()).not.toThrow();
    expect(toasts(ctx)).toEqual([]);
  });
});
