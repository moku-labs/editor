// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"navigation":{"disableChildFrameNavigation":true}}}
/* eslint-disable unicorn/no-null -- null is a JSON value of the published directory */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceDirectory } from "../../../connect/protocol";
import type { SessionInfo } from "../../../registry/protocol";
import { removeFrameLayer } from "../../frame/frame";
import { dropStart, START_TIMEOUT_MS, startLocalPreview } from "../../frame/start";
import { stopWorkspace } from "../../lifecycle";
import { createCtx, flush, ownSessionOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// W12 workspace.startLocalPreview(): mount the one game frame when it is not
// mounted, resolve once its own session is listed; one wait for two calls; a
// page without a game frame (moku-editor perf) rejects and mounts nothing.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let sessionsListeners: Set<(list: readonly SessionInfo[]) => void>;

/**
 * The device directory of a hub whose device mode `moku-editor perf` turned on.
 *
 * @returns The directory.
 */
function perfDirectory(): DeviceDirectory {
  return {
    v: 1,
    mode: {
      on: true,
      owner: "other",
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null }
    },
    confirmIn: "terminal",
    adb: { available: true },
    wire: [],
    asking: [],
    linked: [],
    at: 1
  };
}

/**
 * Lists sessions like link does: the list is applied, then every onSessions listener runs.
 *
 * @param list - The sessions.
 */
function listSessions(list: SessionInfo[]): void {
  ctx.link.sessionList = list;
  for (const listener of sessionsListeners) listener(list);
}

/**
 * The game iframes in the document.
 *
 * @returns Their count.
 */
function frames(): number {
  return document.querySelectorAll("iframe[data-game-frame]").length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  ctx = createCtx();
  sessionsListeners = new Set();
  ctx.link.onSessions.mockImplementation(listener => {
    sessionsListeners.add(listener);
    return () => {
      sessionsListeners.delete(listener);
    };
  });
  ctx.link.ownSession.mockImplementation(
    () =>
      ctx.link.sessionList.find(session => session.embedded && session.page.includes("f-test"))?.id
  );
});

afterEach(() => {
  removeFrameLayer(ctx.state);
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("startLocalPreview", () => {
  it("mounts an unmounted frame once and resolves when ownSession() answers", async () => {
    const settled = vi.fn();
    const first = startLocalPreview(ctx).then(settled);
    expect(frames()).toBe(1);
    expect(document.querySelector("iframe[data-game-frame]")?.getAttribute("src")).toContain(
      "__editorFrame=f-test"
    );

    // A list without the frame's session leaves it waiting.
    listSessions([
      { ...ownSessionOf("s-2"), page: "http://127.0.0.1:3000/other", embedded: false }
    ]);
    await flush();
    expect(settled).not.toHaveBeenCalled();

    listSessions([ownSessionOf("s-1")]);
    await first;
    expect(settled).toHaveBeenCalledOnce();
    expect(frames()).toBe(1);
    expect(sessionsListeners.size).toBe(0);
    expect(ctx.state.start).toBeUndefined();
  });

  it("a second call while pending shares the promise and mounts nothing more", async () => {
    const first = startLocalPreview(ctx);
    const second = startLocalPreview(ctx);
    expect(second).toBe(first);
    expect(frames()).toBe(1);
    expect(ctx.link.onSessions).toHaveBeenCalledOnce();

    listSessions([ownSessionOf("s-1")]);
    await expect(second).resolves.toBeUndefined();
  });

  it("an already running preview resolves at once without a second mount", async () => {
    const first = startLocalPreview(ctx);
    listSessions([ownSessionOf("s-1")]);
    await first;
    expect(frames()).toBe(1);

    await expect(startLocalPreview(ctx)).resolves.toBeUndefined();
    expect(frames()).toBe(1);
    expect(ctx.link.onSessions).toHaveBeenCalledOnce();
  });

  it("a page without a game frame rejects with the two-line error and mounts nothing", async () => {
    // Bug: the Render button on the moku-editor perf page mounting an empty frame that never gets
    // a session and spins forever.
    ctx.link.directoryValue = perfDirectory();

    await expect(startLocalPreview(ctx)).rejects.toThrow(
      "[moku-editor] workspace.startLocalPreview() needs a game frame.\n  This page shows a device only; open the tools page of moku-editor <game> to run the game here."
    );
    expect(frames()).toBe(0);
    expect(ctx.link.onSessions).not.toHaveBeenCalled();
    expect(ctx.state.start).toBeUndefined();
  });

  it("a page whose device mode the tools page turned on still has its frame", async () => {
    ctx.link.directoryValue = {
      ...perfDirectory(),
      mode: { ...perfDirectory().mode, owner: "connect" }
    };
    const pending = startLocalPreview(ctx);
    expect(frames()).toBe(1);
    listSessions([ownSessionOf("s-1")]);
    await expect(pending).resolves.toBeUndefined();
  });

  it("no session within 15 s rejects with the did-not-start error naming the frame's URL", async () => {
    const pending = startLocalPreview(ctx);
    const caught = pending.catch((error: unknown) => error);

    vi.advanceTimersByTime(START_TIMEOUT_MS - 1);
    await flush();
    expect(ctx.state.start).toBeDefined();

    vi.advanceTimersByTime(1);
    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "[moku-editor] The local preview did not start.\n  Check the game's console in the Console workspace; the frame is mounted at http://127.0.0.1:3000/game/."
    );
    expect(sessionsListeners.size).toBe(0);
    expect(ctx.state.start).toBeUndefined();
    // The next call waits again on the frame that is already there.
    const again = startLocalPreview(ctx);
    expect(frames()).toBe(1);
    expect(ctx.state.start?.promise).toBe(again);
    listSessions([ownSessionOf("s-1")]);
    await expect(again).resolves.toBeUndefined();
  });

  it("onStop drops the wait: nothing settles, no listener and no timer is left", async () => {
    const settled = vi.fn();
    startLocalPreview(ctx).then(settled, settled);
    stopWorkspace(ctx);

    expect(sessionsListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(ctx.state.start).toBeUndefined();

    // dropStart with nothing pending changes nothing.
    dropStart(ctx.state);
    expect(ctx.state.start).toBeUndefined();
  });

  it("after stop it mounts nothing", () => {
    stopWorkspace(ctx);
    expect(startLocalPreview(ctx)).toBeInstanceOf(Promise);
    expect(frames()).toBe(0);
    expect(ctx.link.onSessions).not.toHaveBeenCalled();
  });
});
