/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json, RunResult } from "../../../registry/protocol";
import { registerCaptureCommands } from "../../commands";
import { browserClock } from "../../series";
import { WARN_SHOTS } from "../../types";
import type { FakeRegistry, TestDeps } from "../helpers";
import { createDeps, ENVELOPE, fakeClock, fakeRegistry, PNG, rejectionOf } from "../helpers";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Registers the capture commands into a fake registry.
 *
 * @param registry - The fake registry.
 * @param deps - The deps (a fake clock by default).
 * @returns The registry and the deps.
 */
function setup(registry: FakeRegistry = fakeRegistry(), deps: TestDeps = createDeps(fakeClock())) {
  registerCaptureCommands(registry, deps);
  return { registry, deps };
}

/**
 * Runs an added command.
 *
 * @param registry - The fake registry.
 * @param id - The command id.
 * @param input - The raw input.
 * @returns The run result.
 */
function run(registry: FakeRegistry, id: string, input: Json = null): Promise<RunResult> {
  const entry = registry.added.get(id);
  if (entry === undefined) throw new Error(`${id} was not added`);
  return entry.run(input);
}

describe("registerCaptureCommands", () => {
  it("adds the three read commands with their titles and inputs", () => {
    const { registry } = setup();

    expect([...registry.added.values()].map(entry => entry.descriptor)).toEqual([
      { id: "editor.capture", title: "Screenshot", input: {}, effect: "read" },
      {
        id: "editor.series",
        title: "Record a series",
        input: { durationMs: "number", intervalMs: "number" },
        effect: "read"
      },
      { id: "editor.seriesStop", title: "Stop the series", input: {}, effect: "read" }
    ]);
  });

  it("takes no picture on its own", () => {
    const { registry } = setup();

    expect(registry.capture).not.toHaveBeenCalled();
  });
});

describe("editor.capture", () => {
  it("answers the picture, the engine's frame and the device", async () => {
    const { registry } = setup();

    const ran = await run(registry, "editor.capture");

    expect(ran).toEqual({
      value: { image: PNG, frame: 1778, device: { w: 0, h: 0, orientation: "portrait" } },
      state: { ...ENVELOPE, frame: 1778 }
    });
  });

  it("refuses unknown input fields with -32602", async () => {
    const { registry } = setup();

    expect(await rejectionOf(run(registry, "editor.capture", { x: 1 }))).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", field: "x" }
    });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("answers the picture of a game 0.4 door that answers { png, legend }", async () => {
    const { registry } = setup(fakeRegistry(() => ({ value: { png: PNG, legend: [] } })));

    const ran = await run(registry, "editor.capture");

    expect(ran.value).toEqual({
      image: PNG,
      frame: 1778,
      device: { w: 0, h: 0, orientation: "portrait" }
    });
  });

  it("rejects -32000 when the door gives no picture", async () => {
    const { registry } = setup(fakeRegistry(() => ({ value: null })));

    expect(await rejectionOf(run(registry, "editor.capture"))).toMatchObject({ code: -32_000 });
  });
});

describe("editor.series", () => {
  it("answers the shots and the device, with the state of the last shot", async () => {
    const { registry } = setup();

    const ran = await run(registry, "editor.series", { durationMs: 300, intervalMs: 100 });

    expect(ran).toEqual({
      value: {
        shots: [
          { image: PNG, frame: 1778, atMs: 0 },
          { image: PNG, frame: 1779, atMs: 100 },
          { image: PNG, frame: 1780, atMs: 200 }
        ],
        device: { w: 0, h: 0, orientation: "portrait" }
      },
      state: { ...ENVELOPE, frame: 1780 }
    });
  });

  it("records a game 0.4 door that answers { png }: the shots carry the png", async () => {
    const { registry } = setup(fakeRegistry(() => ({ value: { png: PNG } })));

    const ran = await run(registry, "editor.series", { durationMs: 200, intervalMs: 100 });

    expect(ran.value).toEqual({
      shots: [
        { image: PNG, frame: 1778, atMs: 0 },
        { image: PNG, frame: 1779, atMs: 100 }
      ],
      device: { w: 0, h: 0, orientation: "portrait" }
    });
  });

  it("checks the input against its schema", async () => {
    const { registry } = setup();

    expect(
      await rejectionOf(run(registry, "editor.series", { durationMs: "1s", intervalMs: 100 }))
    ).toMatchObject({ code: -32_602, data: { field: "durationMs" } });
    expect(await rejectionOf(run(registry, "editor.series", { durationMs: 100 }))).toMatchObject({
      code: -32_602,
      data: { field: "intervalMs" }
    });
  });

  it("refuses a series over the limits with -32602 naming the field", async () => {
    const { registry } = setup();

    expect(
      await rejectionOf(run(registry, "editor.series", { durationMs: 20_001, intervalMs: 100 }))
    ).toMatchObject({ code: -32_602, data: { field: "durationMs" } });
    expect(
      await rejectionOf(run(registry, "editor.series", { durationMs: 1000, intervalMs: 10 }))
    ).toMatchObject({ code: -32_602, data: { field: "intervalMs" } });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("logs a warning above WARN_SHOTS planned shots and still records", async () => {
    const { registry, deps } = setup();
    const intervalMs = 16;
    const durationMs = (WARN_SHOTS + 1) * intervalMs;

    const ran = await run(registry, "editor.series", { durationMs, intervalMs });

    expect(deps.log.warn).toHaveBeenCalledWith("capture:series-large", {
      count: WARN_SHOTS + 1,
      durationMs,
      intervalMs
    });
    expect(registry.capture).toHaveBeenCalledTimes(WARN_SHOTS + 1);
    expect(ran.state.frame).toBe(1777 + WARN_SHOTS + 1);
  });

  it("does not warn at WARN_SHOTS planned shots", async () => {
    const { registry, deps } = setup();

    await run(registry, "editor.series", { durationMs: WARN_SHOTS * 16, intervalMs: 16 });

    expect(deps.log.warn).not.toHaveBeenCalled();
  });

  it("rejects -32000 when no shot gave a picture", async () => {
    const { registry, deps } = setup(fakeRegistry(() => ({ value: null })));

    expect(
      await rejectionOf(run(registry, "editor.series", { durationMs: 200, intervalMs: 100 }))
    ).toMatchObject({
      code: -32_000,
      message:
        "[moku-editor] editor.series took no picture.\n  The renderer is inert, headless or this is not a dev build.",
      data: { reason: "command_failed", id: "editor.series" }
    });
    expect(deps.state.series).toBeUndefined();
  });

  it("refuses a second series while one records", async () => {
    vi.useFakeTimers();
    const { registry, deps } = setup(
      fakeRegistry(),
      createDeps({ now: () => Date.now(), wait: browserClock.wait })
    );

    const first = run(registry, "editor.series", { durationMs: 1000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      await rejectionOf(run(registry, "editor.series", { durationMs: 1000, intervalMs: 100 }))
    ).toMatchObject({
      code: -32_000,
      message: "[moku-editor] A series is already recording.\n  Stop it or wait for it to end.",
      data: { reason: "command_failed", id: "editor.series" }
    });

    await vi.advanceTimersByTimeAsync(1000);
    const ran = await first;
    expect(ran.value).toMatchObject({ shots: Array.from({ length: 10 }, () => ({ image: PNG })) });
    expect(deps.state.series).toBeUndefined();
  });
});

describe("editor.seriesStop", () => {
  it("answers stopped: false and the registry envelope when idle", async () => {
    const { registry } = setup();

    expect(await run(registry, "editor.seriesStop")).toEqual({
      value: { stopped: false },
      state: ENVELOPE
    });
  });

  it("refuses unknown input fields with -32602", async () => {
    const { registry } = setup();

    expect(await rejectionOf(run(registry, "editor.seriesStop", { now: true }))).toMatchObject({
      code: -32_602,
      data: { field: "now" }
    });
  });

  it("ends a running series, which resolves with the shots so far", async () => {
    vi.useFakeTimers();
    const { registry, deps } = setup(
      fakeRegistry(),
      createDeps({ now: () => Date.now(), wait: browserClock.wait })
    );

    const series = run(registry, "editor.series", { durationMs: 1000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(250);

    expect(await run(registry, "editor.seriesStop")).toEqual({
      value: { stopped: true },
      state: ENVELOPE
    });

    const ran = await series;
    expect(ran.value).toMatchObject({
      shots: [{ atMs: 0 }, { atMs: 100 }, { atMs: 200 }]
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.state.series).toBeUndefined();
  });
});
