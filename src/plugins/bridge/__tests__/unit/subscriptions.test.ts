/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import { describe, expect, it } from "vitest";
import type { WatchParams } from "../../../registry/protocol";
import { failure, notification, request, success, wireError } from "../../../registry/protocol";
import {
  dropAll,
  pushValue,
  refreshAll,
  sampleFrames,
  subscribe,
  unsubscribe
} from "../../dispatch/subscriptions";
import { HIGH_WATER } from "../../types";
import type { TestDeps } from "../helpers";
import { deferred, flush, openDeps } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Followed (edge/commit) and throttled (frame) subscriptions, dedupe, replace,
// unwatch, the per-beat sampling and the post-run refresh.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subscribes like the dispatcher does.
 *
 * @param deps - The test deps.
 * @param params - The watch params.
 * @param id - The request id.
 */
async function watch(deps: TestDeps, params: WatchParams, id = 1): Promise<void> {
  await subscribe(deps, request(id, "game", "watch", params), params);
}

describe("subscribe — edge and commit sources", () => {
  it("responds null before the first value", async () => {
    const { deps, socket } = openDeps();

    await watch(deps, { sub: 1, id: "game.position" });

    expect(socket.messages()).toEqual([
      success(1, null),
      notification("game", "value", { sub: 1, value: { path: "home" } })
    ]);
    expect(deps.state.subs.get(1)).toMatchObject({
      sub: 1,
      id: "game.position",
      changes: "edge",
      lastSent: JSON.stringify({ path: "home" })
    });
  });

  it("passes the input to the channel watch", async () => {
    const { deps } = openDeps();

    await watch(deps, { sub: 1, id: "game.model", input: { deep: true } });

    expect(deps.state.subs.get(1)).toMatchObject({ input: { deep: true }, changes: "commit" });
    expect(deps.channel.watchers.has("game.model")).toBe(true);
  });

  it("sends later changes and drops equal consecutive values", async () => {
    const { deps, socket } = openDeps();
    await watch(deps, { sub: 1, id: "game.position" });
    socket.clear();
    const onValue = deps.channel.watchers.get("game.position");

    onValue?.({ path: "home" });
    onValue?.({ path: "board" });
    onValue?.({ path: "board" });

    expect(socket.messages()).toEqual([
      notification("game", "value", { sub: 1, value: { path: "board" } })
    ]);
  });

  it("replaces a subscription with the same sub", async () => {
    const { deps } = openDeps();
    await watch(deps, { sub: 1, id: "game.position" });

    await watch(deps, { sub: 1, id: "game.model" }, 2);

    expect(deps.channel.stops).toBe(1);
    expect(deps.state.subs.get(1)?.id).toBe("game.model");
    expect(deps.state.subs.size).toBe(1);
  });

  it("answers -32601 unknown_id for an unknown source and keeps no subscription", async () => {
    const { deps, socket } = openDeps();

    await watch(deps, { sub: 1, id: "game.nope" });

    expect(socket.messages()).toEqual([
      failure(1, {
        code: -32_601,
        message: "[moku-editor] game.nope: unknown source",
        data: { reason: "unknown_id", retryable: false, id: "game.nope" }
      })
    ]);
    expect(deps.state.subs.size).toBe(0);
  });

  it("answers a synchronous watch error and keeps no subscription", async () => {
    const { deps, socket } = openDeps();

    await watch(deps, { sub: 1, id: "game.broken" });

    expect(socket.messages()).toEqual([
      failure(1, { code: -32_602, message: "[moku-editor] game.broken: bad input" })
    ]);
    expect(deps.state.subs.size).toBe(0);
  });
});

describe("subscribe — frame sources (throttled, R6)", () => {
  it("reads once at once, without a channel watch", async () => {
    const { deps, socket } = openDeps();

    await watch(deps, { sub: 2, id: "game.render" });

    expect(socket.messages()).toEqual([
      success(1, null),
      notification("game", "value", { sub: 2, value: { fps: 60 } })
    ]);
    expect(deps.channel.watchers.size).toBe(0);
    expect(deps.state.subs.get(2)).toMatchObject({ changes: "frame", stop: undefined });
  });

  it("answers a read error and keeps no subscription", async () => {
    const { deps, socket } = openDeps();
    deps.channel.readErrors.set("game.render", wireError(-32_000, "render broke"));

    await watch(deps, { sub: 2, id: "game.render" });

    expect(socket.messages()).toEqual([
      failure(1, { code: -32_000, message: "[moku-editor] render broke" })
    ]);
    expect(deps.state.subs.size).toBe(0);
  });

  it("sends nothing when unwatched while the first read is pending", async () => {
    const { deps, socket } = openDeps();
    const gate = deferred<undefined>();
    deps.channel.holds.set(
      "game.render",
      gate.promise.then(() => {})
    );

    const watching = watch(deps, { sub: 2, id: "game.render" });
    unsubscribe(deps, 2);
    gate.resolve(undefined);
    await watching;

    expect(socket.messages()).toEqual([success(1, null)]);
    expect(deps.state.subs.size).toBe(0);
  });
});

describe("unsubscribe and dropAll", () => {
  it("unsubscribe stops the channel watch and forgets the pending value", async () => {
    const { deps } = openDeps();
    await watch(deps, { sub: 1, id: "game.position" });
    deps.state.pending.set(1, "x");

    unsubscribe(deps, 1);
    unsubscribe(deps, 1);

    expect(deps.channel.stops).toBe(1);
    expect(deps.state.subs.size).toBe(0);
    expect(deps.state.pending.size).toBe(0);
  });

  it("dropAll stops every sub and clears subs and pending", async () => {
    const { deps } = openDeps();
    await watch(deps, { sub: 1, id: "game.position" });
    await watch(deps, { sub: 2, id: "game.model" });
    await watch(deps, { sub: 3, id: "game.render" });
    deps.state.pending.set(3, 1);

    dropAll(deps);

    expect(deps.channel.stops).toBe(2);
    expect(deps.state.subs.size).toBe(0);
    expect(deps.state.pending.size).toBe(0);
  });
});

describe("sampleFrames", () => {
  it("re-reads frame subs only and sends a value only when it changed", async () => {
    const { deps, socket } = openDeps();
    await watch(deps, { sub: 1, id: "game.position" });
    await watch(deps, { sub: 2, id: "game.render" });
    socket.clear();
    deps.channel.reads.length = 0;

    sampleFrames(deps);
    await flush();
    expect(socket.sent).toEqual([]);
    expect(deps.channel.reads.map(read => read.id)).toEqual(["game.render"]);

    deps.channel.values.set("game.render", { fps: 58 });
    sampleFrames(deps);
    await flush();

    expect(socket.messages()).toEqual([
      notification("game", "value", { sub: 2, value: { fps: 58 } })
    ]);
  });

  it("is skipped while the socket is congested", async () => {
    const { deps, socket } = openDeps();
    await watch(deps, { sub: 2, id: "game.render" });
    deps.channel.reads.length = 0;
    socket.bufferedAmount = HIGH_WATER + 1;

    sampleFrames(deps);
    await flush();

    expect(deps.channel.reads).toEqual([]);
  });

  it("keeps the sub when a sample read fails, and logs at debug", async () => {
    const { deps } = openDeps();
    await watch(deps, { sub: 2, id: "game.render" });
    deps.channel.readErrors.set("game.render", new Error("gone"));

    sampleFrames(deps);
    await flush();

    expect(deps.state.subs.has(2)).toBe(true);
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:sample-failed", {
      sub: 2,
      id: "game.render",
      message: "gone"
    });
  });
});

describe("refreshAll", () => {
  it("re-reads every sub and pushes the changed values only", async () => {
    const { deps, socket } = openDeps();
    await watch(deps, { sub: 1, id: "game.position" });
    await watch(deps, { sub: 2, id: "game.model" });
    await watch(deps, { sub: 3, id: "game.render" });
    socket.clear();
    deps.channel.values.set("game.position", { path: "board" });

    refreshAll(deps);
    await flush();

    expect(socket.messages()).toEqual([
      notification("game", "value", { sub: 1, value: { path: "board" } })
    ]);
  });

  it("does not push for a sub that went away while reading", async () => {
    const { deps, socket } = openDeps();
    await watch(deps, { sub: 1, id: "game.position" });
    socket.clear();
    deps.channel.values.set("game.position", { path: "board" });

    refreshAll(deps);
    unsubscribe(deps, 1);
    await flush();

    expect(socket.sent).toEqual([]);
  });
});

describe("pushValue", () => {
  it("ignores an unknown sub", () => {
    const { deps, socket } = openDeps();

    pushValue(deps, 42, 1);

    expect(socket.sent).toEqual([]);
  });
});
