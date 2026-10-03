import { afterEach, describe, expect, it, vi } from "vitest";
import type { Capture } from "../../src/agent";
import {
  bareMessage,
  type Heartbeat,
  isRetryable,
  type Json,
  type LinkStatus,
  type Manifest,
  ProtocolError
} from "../../src/index";
import {
  bootTools,
  createProject,
  createTinyGame,
  installPage,
  PNG_1X1,
  paramsOf,
  type Stack,
  type Stoppable,
  shutdown,
  startAgent,
  startServer,
  startStack,
  type Tap,
  TINY_NAME,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-plugin wire scenarios W1–W5 (plan §3, cross-wire.test.ts): the agent on
// a tiny game, the real hub on Bun.serve and the link in the tools app. The
// manifest, reads, watches, runs, errors, deadlines and the session choice all
// cross agent → hub → link and back.
// ─────────────────────────────────────────────────────────────────────────────

/** Every stack and part a test started; `afterEach` shuts them down. */
let started: (Stoppable | undefined)[] = [];

afterEach(async () => {
  await shutdown(...started);
  started = [];
});

/**
 * Starts the whole stack and registers it for shutdown.
 *
 * @param options - The startStack options.
 * @returns The live stack.
 */
async function liveStack(options?: Parameters<typeof startStack>[0]): Promise<Stack> {
  const stack = await startStack(options);
  started.push(stack);
  return stack;
}

/**
 * The protocol error a call rejected with; fails when it resolved or rejected with something else.
 *
 * @param call - The call.
 * @returns The protocol error.
 */
async function failureOf(call: Promise<unknown>): Promise<ProtocolError> {
  const outcome = await call.then(
    value => ({ resolved: value }),
    (error: unknown) => ({ rejected: error })
  );
  if ("resolved" in outcome) throw new Error("the call resolved, a rejection was expected");
  if (!(outcome.rejected instanceof ProtocolError)) {
    throw new Error(`the call rejected with a non-protocol error: ${String(outcome.rejected)}`);
  }
  return outcome.rejected;
}

/**
 * The frame of a live or paused status; fails for any other kind.
 *
 * @param status - A link status.
 * @returns Its frame.
 */
function frameOf(status: LinkStatus): number {
  if (status.kind !== "live" && status.kind !== "paused") {
    throw new Error(`the link is ${status.kind}, a frame was expected`);
  }
  return status.frame;
}

/**
 * True when two values have the same JSON text.
 *
 * @param left - One value.
 * @param right - The other.
 * @returns Whether they match.
 */
function sameJson(left: Json | undefined, right: Json): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Fails when two neighbours of a value list are equal (one value per change).
 *
 * @param values - The values in arrival order.
 */
function expectNoRepeats(values: readonly Json[]): void {
  for (let index = 1; index < values.length; index += 1) {
    expect(values[index]).not.toEqual(values[index - 1]);
  }
}

/**
 * True when an `editor.series` value has the `{ shots, device }` shape (R2).
 *
 * @param value - The run value, straight off the wire.
 * @returns Whether it is a series value.
 */
function isSeriesValue(value: unknown): value is Capture.SeriesValue {
  if (typeof value !== "object" || value === null) return false;
  return "shots" in value && Array.isArray(value.shots) && "device" in value;
}

/**
 * The `sub` numbers of the tools `watch` requests on the tap.
 *
 * @param tap - The wire tap.
 * @returns Every sub, in order.
 */
function toolsWatchSubs(tap: Tap): (Json | undefined)[] {
  return tap.requests("tools", "watch", "game").map(message => paramsOf(message)?.sub);
}

describe("cross-wire: agent → hub → link", () => {
  it("W1 carries the manifest from the agent to the link", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("tiny");
    const server = await startServer(root);
    started.push(server);
    installPage(server.origin, server.app.hub.path());
    const tools = await bootTools(server);
    started.push(tools);
    const { link } = tools.app;
    const heard: (Manifest | undefined)[] = [];
    link.onManifest(manifest => {
      heard.push(manifest);
    });
    const game = await createTinyGame();
    started.push(game);
    const agent = await startAgent(server, game);
    started.push(agent);

    await until(
      () => link.status().kind === "live" && link.manifest() !== undefined,
      "a live link with a manifest"
    );

    const session = link.session();
    expect(link.sessions()).toHaveLength(1);
    expect(link.sessions()[0]).toMatchObject({ id: session, game: TINY_NAME, embedded: true });
    expect(session).toBe(server.app.hub.sessions()[0]?.id);
    expect(link.manifest()).toEqual(agent.app.registry.manifest());
    const manifests = heard.filter(manifest => manifest !== undefined);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toEqual(agent.app.registry.manifest());
    const last = tools.eventsOf("link:status").at(-1);
    expect(last).toEqual({ status: { kind: "live", frame: expect.any(Number) }, session });
    expect(frameOf(last?.status ?? { kind: "empty" })).toBeGreaterThan(0);
  });

  it("W2 reads, watches and runs through the wire", async () => {
    const stack = await liveStack();
    const { link } = stack.tools.app;
    const { channel } = stack.agent.app;

    // 1. read
    const position = await link.read("game.position");
    expect(position).toEqual(await channel.read("game.position"));

    // 2. watch: the current value first. The tiny game rests only at home, so a play round
    // ends where it started; game.model carries the change of the run instead.
    const positions: Json[] = [];
    const models: Json[] = [];
    const stopPositions = link.watch("game.position", undefined, value => {
      positions.push(value);
    });
    const stopModels = link.watch("game.model", undefined, value => {
      models.push(value);
    });
    await until(() => positions.length > 0 && models.length > 0, "the first watched values");
    expect(positions[0]).toEqual(position);
    expect(models[0]).toEqual(await channel.read("game.model"));

    // 3. run, then one frame, as a live page runs one
    const ran = await link.run("game.answer", { intent: "play" });
    expect(ran.state).toEqual({ path: "home", frame: expect.any(Number), tainted: false });
    await stack.game.frames(1);
    const model = await channel.read("game.model");
    await until(() => sameJson(models.at(-1), model), "the game.model value after the run");
    expect(models.length).toBeGreaterThan(1);
    expect(models.at(-1)).not.toEqual(models[0]);
    expect(stack.game.app.model.store.snapshot().player).toEqual({ coins: 5, visits: 1 });
    expectNoRepeats(positions);
    stopPositions();
    stopModels();

    // 4. a frame source: one value per change, sampled per heartbeat
    const counts: Json[] = [];
    const watchedAt = performance.now();
    link.watch("tiny.count", undefined, value => {
      counts.push(value);
    });
    await until(() => counts.length > 0, "the first tiny.count value");
    await link.run("tiny.bump");
    await link.run("tiny.bump");
    await until(() => counts.length >= 3, "tiny.count at 2");
    // Two more heartbeats reach the tools: each one re-samples the frame source, so a repeat
    // would be on the wire before them. A read after them flushes the tools socket in order.
    const beatsToTools = () => stack.server.tap.sent("tools", "heartbeat").length;
    const beatsAtTwo = beatsToTools();
    await until(() => beatsToTools() >= beatsAtTwo + 2, "two heartbeats after tiny.count 2");
    expect(await link.read("tiny.count")).toBe(2);
    expect(counts).toEqual([0, 1, 2]);
    expectNoRepeats(counts);
    const agentSub = stack.server.tap
      .sent("agent", "watch")
      .map(message => paramsOf(message))
      .findLast(params => params?.id === "tiny.count")?.sub;
    const fromAgent = stack.server.tap.entries.filter(
      entry => entry.dir === "in" && entry.kind === "agent" && entry.at >= watchedAt
    );
    const values = fromAgent.filter(
      entry =>
        "method" in entry.message &&
        entry.message.method === "value" &&
        paramsOf(entry.message)?.sub === agentSub
    );
    const beats = fromAgent.filter(
      entry => "method" in entry.message && entry.message.method === "heartbeat"
    );
    expect(values.length).toBeLessThanOrEqual(beats.length + 2);

    // heartbeat frame and link frame agree
    expect(Math.abs(frameOf(link.status()) - channel.heartbeat().frame)).toBeLessThanOrEqual(2);

    // onHeartbeat and its remover: each beat carries the game clock, so a stepped frame shows up
    const heardBeats: Heartbeat[] = [];
    const removeBeat = channel.onHeartbeat(beat => {
      heardBeats.push(beat);
    });
    await until(() => heardBeats.length > 0, "a first heartbeat");
    const firstFrame = heardBeats[0]?.frame ?? 0;
    await stack.game.frames(1);
    await until(
      () => heardBeats.some(beat => beat.frame > firstFrame),
      "a heartbeat after one frame"
    );
    expect(heardBeats.find(beat => beat.frame > firstFrame)?.frame).toBe(firstFrame + 1);
    await until(() => heardBeats.length >= 3, "three heartbeats");
    removeBeat();
    const heardBefore = heardBeats.length;
    // A second listener counts the next beats: the removed one hears none of them.
    let probeBeats = 0;
    const removeProbe = channel.onHeartbeat(() => {
      probeBeats += 1;
    });
    await until(() => probeBeats >= 2, "two heartbeats after the remover");
    removeProbe();
    expect(heardBeats).toHaveLength(heardBefore);

    // 5. a cheat taints the run
    const warned = await link.run("tiny.warn");
    expect(warned.state.tainted).toBe(true);
    expect(await link.read("game.tainted")).toBe(true);
  });

  it("W2 a watch over the wire settles on the state a run left", async () => {
    const stack = await liveStack();
    const { link } = stack.tools.app;
    const { channel } = stack.agent.app;
    const positions: Json[] = [];
    link.watch("game.position", undefined, value => {
      positions.push(value);
    });
    await until(() => positions.length > 0, "the first game.position value");

    await link.run("game.answer", { intent: "play" });
    await stack.game.frames(1);
    const settled = await channel.read("game.position");

    await until(() => sameJson(positions.at(-1), settled), "the settled game.position", 1000);
    expect(positions.at(-1)).toEqual(settled);
  });

  it("W3 keeps the error code across every hop", async () => {
    const stack = await liveStack();
    const { link } = stack.tools.app;
    const errors: ProtocolError[] = [];

    const badInput = await failureOf(link.run("game.step", { frames: "x" }));
    errors.push(badInput);
    expect(badInput.code).toBe(-32_602);
    expect(badInput.data?.field).toBe("frames");
    const stepsSent = stack.server.tap
      .sent("agent", "run")
      .filter(message => paramsOf(message)?.id === "game.step");
    expect(stepsSent).toEqual([]);

    const unknown = await failureOf(link.read("nope.id"));
    errors.push(unknown);
    expect(unknown.code).toBe(-32_601);

    const failed = await failureOf(link.run("tiny.fail"));
    errors.push(failed);
    expect(failed.code).toBe(-32_000);
    expect(failed.message.startsWith("[moku-editor]")).toBe(true);
    expect(bareMessage(failed.message)).toContain("boom");

    expect(await link.read("tiny.map")).toEqual({ $map: [["a", 1]] });

    const notJson = await failureOf(link.read("tiny.fn"));
    errors.push(notJson);
    expect(notJson.code).toBe(-32_006);

    expect(errors.map(error => isRetryable(error))).toEqual([false, false, false, false]);
  });

  it("W4 holds the deadlines of long calls and times out a hang", async () => {
    const stack = await liveStack({
      server: { hub: { callTimeoutMs: 300 } },
      agent: { png: PNG_1X1, configs: { bridge: { callTimeoutMs: 300 } } }
    });
    const { link } = stack.tools.app;

    // 1. a 600 ms series outlives the 300 ms deadlines while the test steps frames
    let done = false;
    const series = link.run("editor.series", { durationMs: 600, intervalMs: 100 }).finally(() => {
      done = true;
    });
    while (!done) await stack.game.frames(1);
    const { value } = await series;
    if (!isSeriesValue(value)) throw new Error("editor.series answered no { shots, device }");
    const { shots, device } = value;
    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(shots.length).toBeLessThanOrEqual(7);
    for (const [index, shot] of shots.entries()) {
      expect(shot).toEqual({
        image: expect.any(String),
        frame: expect.any(Number),
        atMs: expect.any(Number)
      });
      if (index > 0) expect(shot.frame).toBeGreaterThanOrEqual(shots[index - 1]?.frame ?? 0);
    }
    // The game page viewport (happy-dom's 1024 × 768), not the workspace device preset.
    expect(device).toEqual({ w: 1024, h: 768, orientation: "landscape" });

    // 2. a hang times out at the 300 ms deadline
    const hungAt = performance.now();
    const hang = await failureOf(link.run("tiny.hang"));
    const took = performance.now() - hungAt;
    expect(hang.code).toBe(-32_002);
    expect(hang.data).toMatchObject({ reason: "timeout", retryable: true });
    expect(took).toBeGreaterThanOrEqual(250);
    expect(took).toBeLessThan(1500);

    // 3. the link stays live
    expect(link.status().kind).toBe("live");

    // 4. a series past the cap is refused, naming the field
    const tooLong = await failureOf(
      link.run("editor.series", { durationMs: 30_000, intervalMs: 100 })
    );
    expect(tooLong.code).toBe(-32_602);
    expect(tooLong.data?.field).toBe("durationMs");
  });

  it("W5 routes by the chosen session and falls back when it closes", async () => {
    const stack = await liveStack();
    const { server } = stack;
    const { link } = stack.tools.app;
    const firstId = link.session();
    const firstGame = stack.game;
    const firstAgent = stack.agent;

    // 1. a second game page connects
    const secondGame = await createTinyGame();
    started.push(secondGame);
    const second = await startAgent(server, secondGame);
    started.push(second);
    await until(
      () => link.sessions().length === 2 && second.app.bridge.session() !== undefined,
      "two sessions, the second agent knows its id"
    );
    const secondId = second.app.bridge.session();
    expect(secondId).toBeTypeOf("string");
    expect(secondId).not.toBe(firstId);
    expect(link.sessions().find(session => session.id !== firstId)?.id).toBe(secondId);

    // The newest session wins.
    await until(
      () => link.session() === secondId && link.status().kind === "live",
      "the link on the newest session"
    );

    // 2. watch game.position
    const positions: Json[] = [];
    link.watch("game.position", undefined, value => {
      positions.push(value);
    });
    await until(() => positions.length > 0, "the first game.position value");

    // 3. choose the first session
    const subsBefore = new Set(toolsWatchSubs(server.tap));
    const watchesBefore = server.tap.requests("tools", "watch", "game").length;
    await link.choose(firstId ?? "");
    expect(link.session()).toBe(firstId);
    await until(
      () =>
        server.tap
          .requests("tools", "watch", "game")
          .slice(watchesBefore)
          .some(message => paramsOf(message)?.id === "game.position"),
      "the watch re-sent to the first session"
    );
    const resent = server.tap
      .requests("tools", "watch", "game")
      .slice(watchesBefore)
      .filter(message => paramsOf(message)?.id === "game.position");
    for (const message of resent) {
      expect(subsBefore.has(paramsOf(message)?.sub)).toBe(false);
      expect(message.session).toBe(firstId);
    }

    // 4. the run reaches only the first game
    await link.run("game.answer", { intent: "play" });
    expect(firstGame.app.model.store.snapshot().player).toEqual({ coins: 5, visits: 1 });
    expect(secondGame.app.model.store.snapshot().player).toEqual({ coins: 0, visits: 0 });

    // 5. the chosen game page closes: the link falls back and resubscribes
    const watchesBeforeClose = server.tap.requests("tools", "watch", "game").length;
    const subsBeforeClose = new Set(toolsWatchSubs(server.tap));
    await firstAgent.stop();
    await until(
      () => link.session() === secondId && link.status().kind === "live",
      "the link back on the remaining session"
    );
    await until(
      () =>
        server.tap
          .requests("tools", "watch", "game")
          .slice(watchesBeforeClose)
          .some(message => paramsOf(message)?.id === "game.position"),
      "the watch re-sent to the remaining session"
    );
    const fallback = server.tap
      .requests("tools", "watch", "game")
      .slice(watchesBeforeClose)
      .filter(message => paramsOf(message)?.id === "game.position");
    for (const message of fallback) {
      expect(subsBeforeClose.has(paramsOf(message)?.sub)).toBe(false);
      expect(message.session).toBe(secondId);
    }
  });
});
