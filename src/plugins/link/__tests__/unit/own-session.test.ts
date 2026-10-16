import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkApi } from "../../api";
import type { LinkApi } from "../../types";
import {
  connected,
  createCtx,
  FakeWebSocket,
  sendSessions,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// ownSession (spec 11 § 5.2): the newest open embedded session whose page
// carries this page's frame id — the local preview activeSource pauses.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let socket: FakeWebSocket;
let api: LinkApi;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx, []);
  api = createLinkApi(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A game page URL tagged with a frame id.
 *
 * @param frame - The frame id.
 * @returns The page URL.
 */
function pageOf(frame: string): string {
  return `http://127.0.0.1:3000/?__editorFrame=${frame}`;
}

describe("ownSession", () => {
  it("answers this page's own frame, never another tab's frame nor a copied frame URL", () => {
    // Bug: activeSource pausing the game frame of another tools tab.
    sendSessions(socket, [
      sessionOf("s-own", { embedded: true, page: pageOf(ctx.state.frame), connectedAt: 1000 }),
      sessionOf("s-other", { embedded: true, page: pageOf("aaaaaaaaaaaa"), connectedAt: 2000 }),
      sessionOf("s-window", { embedded: false, page: pageOf(ctx.state.frame), connectedAt: 3000 })
    ]);

    expect(api.ownSession()).toBe("s-own");
  });

  it("the newest of two own sessions wins while the frame reloads", () => {
    // Bug: pausing the old page of a reload while the new one runs.
    sendSessions(socket, [
      sessionOf("s-new", { embedded: true, page: pageOf(ctx.state.frame), connectedAt: 2000 }),
      sessionOf("s-old", { embedded: true, page: pageOf(ctx.state.frame), connectedAt: 1000 })
    ]);

    expect(api.ownSession()).toBe("s-new");
  });

  it("is undefined on a page whose frame has no session, even with other games open", () => {
    // Bug: a page without a local preview (moku-editor perf) treating some game as its own.
    sendSessions(socket, [sessionOf("s-1", { embedded: true }), sessionOf("s-9")]);

    expect(api.ownSession()).toBeUndefined();
  });
});
