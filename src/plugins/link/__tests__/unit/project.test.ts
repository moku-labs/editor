import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, ProjectState } from "../../../registry/protocol";
import { toWireValue } from "../../../registry/protocol";
import { createLinkApi } from "../../api";
import { onProjectNote } from "../../server/project";
import { connected, createCtx, FakeWebSocket, latestSocket, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The project index on the tools page: the hub's editor.project notification is
// parsed, stored frozen and emitted as link:project with the delta views drop by.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let socket: FakeWebSocket;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FIRST: ProjectState = {
  state: "on",
  revision: "r1",
  manifest: "game.json",
  defs: { "node:board/merge": ["nodes/merge.ts"], "flow:board": ["flows/board.ts"] },
  uses: { "node:board/merge": ["flows/board.ts"] },
  broken: {}
};

const SECOND: ProjectState = {
  state: "on",
  revision: "r2",
  previous: "r1",
  manifest: "game.json",
  defs: { "node:board/merge": ["nodes/merge.ts"], "flow:board": ["flows/board.ts"] },
  uses: { "node:board/merge": ["flows/board.ts"] },
  broken: {},
  change: {
    files: ["nodes/merge.ts"],
    moved: [
      { key: "node:board/catchUp", from: "nodes/catch-up.ts", to: "nodes/board/catch-up.ts" }
    ],
    removed: ["nodes/old.ts"]
  }
};

/**
 * Sends an `editor.project` notification on the fake socket.
 *
 * @param state - The state the hub publishes.
 */
function publish(state: ProjectState | Json): void {
  socket.notify("editor", "project", toWireValue(state));
}

/**
 * The `link:project` payloads emitted so far.
 *
 * @returns The payloads, in order.
 */
function projectEvents(): unknown[] {
  return ctx.emit.mock.calls
    .filter(([name]) => name === "link:project")
    .map(([, payload]) => payload);
}

describe("editor.project notification", () => {
  it("project() is undefined before the hub sent a state", () => {
    expect(createLinkApi(ctx).project()).toBeUndefined();
  });

  it("the first state is stored and emitted with an `all` delta", () => {
    publish(FIRST);

    expect(createLinkApi(ctx).project()).toEqual(FIRST);
    expect(projectEvents()).toEqual([
      { state: FIRST, delta: { all: true, files: [], moved: [], removed: [] } }
    ]);
  });

  it("a contiguous state emits the lists of its change", () => {
    publish(FIRST);
    publish(SECOND);

    expect(projectEvents()[1]).toEqual({
      state: SECOND,
      delta: {
        all: false,
        files: ["nodes/merge.ts"],
        moved: [
          { key: "node:board/catchUp", from: "nodes/catch-up.ts", to: "nodes/board/catch-up.ts" }
        ],
        removed: ["nodes/old.ts"]
      }
    });
    expect(createLinkApi(ctx).project()).toEqual(SECOND);
  });

  it("the same revision again (the hub's replay) emits nothing", () => {
    publish(FIRST);
    publish(FIRST);

    expect(projectEvents()).toHaveLength(1);
  });

  it("the same revision with another manifest emits the old and new manifest paths", () => {
    publish(FIRST);
    publish({ ...FIRST, manifest: "assets/game.json" });

    expect(projectEvents()[1]).toEqual({
      state: { ...FIRST, manifest: "assets/game.json" },
      delta: { all: false, files: ["game.json", "assets/game.json"], moved: [], removed: [] }
    });
    expect(createLinkApi(ctx).project()).toMatchObject({ manifest: "assets/game.json" });
  });

  it("a manifest gone at the same revision lists only the old path", () => {
    publish(FIRST);
    publish({ state: "on", revision: "r1", defs: {}, uses: {}, broken: {} });

    expect(projectEvents()[1]).toMatchObject({
      delta: { all: false, files: ["game.json"], moved: [], removed: [] }
    });
  });

  it("the same off reason again emits nothing; on after off is `all`", () => {
    publish({ state: "off", reason: "disabled" });
    publish({ state: "off", reason: "disabled" });
    expect(projectEvents()).toHaveLength(1);

    publish({ state: "off", reason: "stopped" });
    publish(SECOND);
    expect(projectEvents()).toHaveLength(3);
    expect(projectEvents()[2]).toMatchObject({ delta: { all: true } });
  });

  it("keeps the state across a reconnect; a gap after it is `all`", async () => {
    publish(FIRST);
    const old = socket;
    old.drop();
    expect(createLinkApi(ctx).project()).toEqual(FIRST);

    await vi.advanceTimersByTimeAsync(ctx.config.retryMs);
    socket = latestSocket();
    expect(socket).not.toBe(old);
    socket.open();
    publish({ ...SECOND, revision: "r3", previous: "r2" });

    expect(projectEvents()[1]).toMatchObject({
      state: { revision: "r3" },
      delta: { all: true, files: [], moved: [], removed: [] }
    });
  });

  it("stores the state frozen, maps and lists included", () => {
    publish(SECOND);
    const state = createLinkApi(ctx).project();
    if (state?.state !== "on") throw new Error("expected an on state");

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.defs)).toBe(true);
    expect(Object.isFrozen(state.defs["flow:board"])).toBe(true);
    expect(Object.isFrozen(state.change?.moved[0])).toBe(true);
  });

  it("a malformed state is the warning link:bad-project and changes nothing", () => {
    publish(FIRST);
    publish({
      state: "on",
      revision: "r9",
      defs: { "flow:board": "flows/board.ts" },
      uses: {},
      broken: {}
    });
    socket.notify("editor", "project");

    expect(ctx.log.warn).toHaveBeenCalledTimes(2);
    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-project", {});
    expect(createLinkApi(ctx).project()).toEqual(FIRST);
    expect(projectEvents()).toHaveLength(1);
  });

  it("onProjectNote works on the params alone", () => {
    onProjectNote(ctx, toWireValue({ state: "off", reason: "disabled" }));

    expect(ctx.emit).toHaveBeenCalledWith("link:project", {
      state: { state: "off", reason: "disabled" },
      delta: { all: true, files: [], moved: [], removed: [] }
    });
  });
});
