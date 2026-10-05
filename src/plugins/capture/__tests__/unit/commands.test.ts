/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json, RunResult } from "../../../registry/protocol";
import { registerCaptureCommands } from "../../commands";
import { browserClock } from "../../series";
import { WARN_SHOTS } from "../../types";
import type { FakeRegistry, TestDeps } from "../helpers";
import {
  createDeps,
  ENVELOPE,
  fakeClock,
  fakeDecoder,
  fakeRegistry,
  PNG,
  rejectionOf,
  smallJpeg,
  smallPng
} from "../helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  it("adds the four read commands with their titles and inputs", () => {
    const { registry } = setup();

    expect([...registry.added.values()].map(entry => entry.descriptor)).toEqual([
      {
        id: "editor.capture",
        title: "Screenshot",
        input: {
          maxWidth: "number?",
          key: "string?",
          rect: "json?",
          format: "string?",
          quality: "number?"
        },
        effect: "read"
      },
      {
        id: "editor.series",
        title: "Record a series",
        input: { durationMs: "number", intervalMs: "number" },
        effect: "read"
      },
      { id: "editor.seriesStop", title: "Stop the series", input: {}, effect: "read" },
      {
        id: "editor.sheet",
        title: "Contact sheet",
        input: {
          frames: "number",
          everyMs: "number",
          maxWidth: "number?",
          format: "string?",
          quality: "number?"
        },
        effect: "read"
      }
    ]);
  });

  it("takes no picture on its own", () => {
    const { registry } = setup();

    expect(registry.capture).not.toHaveBeenCalled();
  });
});

describe("editor.capture", () => {
  it("answers a JPEG at 0.8 of the picture, the engine's frame and the device", async () => {
    const { registry, deps } = setup();

    const ran = await run(registry, "editor.capture");

    expect(ran).toEqual({
      value: {
        image: smallJpeg(1080, 1920),
        frame: 1778,
        device: { w: 0, h: 0, orientation: "portrait" }
      },
      state: { ...ENVELOPE, frame: 1778 }
    });
    expect(deps.decode.pictures[0]?.encode).toHaveBeenCalledWith({
      size: { width: 1080, height: 1920 },
      format: "jpeg",
      quality: 0.8
    });
  });

  it("format png answers the door's picture as it is", async () => {
    const { registry, deps } = setup();

    const ran = await run(registry, "editor.capture", { format: "png" });

    expect(ran.value).toEqual({
      image: PNG,
      frame: 1778,
      device: { w: 0, h: 0, orientation: "portrait" }
    });
    expect(deps.decode).not.toHaveBeenCalled();
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

    const ran = await run(registry, "editor.capture", { format: "png" });

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

describe("editor.capture with maxWidth", () => {
  it("png answers the picture unchanged and decodes nothing without maxWidth", async () => {
    const { registry, deps } = setup();

    const ran = await run(registry, "editor.capture", { format: "png" });

    expect(ran.value).toMatchObject({ image: PNG });
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("downscales a wider picture to maxWidth, keeping the aspect", async () => {
    const { registry, deps } = setup();

    const ran = await run(registry, "editor.capture", { maxWidth: 540, format: "png" });

    expect(ran).toEqual({
      value: {
        image: smallPng(540, 960),
        frame: 1778,
        device: { w: 0, h: 0, orientation: "portrait" }
      },
      state: { ...ENVELOPE, frame: 1778 }
    });
    expect(deps.decode).toHaveBeenCalledWith(PNG);
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it("downscales and encodes a JPEG by default", async () => {
    const { registry } = setup();

    const ran = await run(registry, "editor.capture", { maxWidth: 540 });

    expect(ran.value).toMatchObject({ image: smallJpeg(540, 960) });
  });

  it("png answers a picture that is not wider than maxWidth unchanged", async () => {
    const deps = { ...createDeps(fakeClock()), decode: fakeDecoder(800, 600) };
    const { registry } = setup(fakeRegistry(), deps);

    const ran = await run(registry, "editor.capture", { maxWidth: 800, format: "png" });

    expect(ran.value).toMatchObject({ image: PNG });
    expect(deps.decode.pictures[0]?.encode).not.toHaveBeenCalled();
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it.each([
    63, 4097, 100.5, 0, -1
  ])("refuses maxWidth %s with -32602 before the door runs", async maxWidth => {
    const { registry } = setup();

    expect(await rejectionOf(run(registry, "editor.capture", { maxWidth }))).toMatchObject({
      code: -32_602,
      message:
        "[moku-editor] editor.capture: maxWidth must be a whole number from 64 to 4096.\n  Pass the widest picture you want, in pixels.",
      data: { reason: "invalid_input", id: "editor.capture", field: "maxWidth" }
    });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("refuses a maxWidth that is not a number", async () => {
    const { registry } = setup();

    expect(await rejectionOf(run(registry, "editor.capture", { maxWidth: "540" }))).toMatchObject({
      code: -32_602,
      data: { field: "maxWidth" }
    });
  });

  it("accepts both ends of the range", async () => {
    const { registry, deps } = setup();

    const smallest = await run(registry, "editor.capture", { maxWidth: 64, format: "png" });
    const largest = await run(registry, "editor.capture", { maxWidth: 4096, format: "png" });

    expect(smallest.value).toMatchObject({ image: smallPng(64, 114) });
    expect(largest.value).toMatchObject({ image: PNG });
    expect(deps.decode).toHaveBeenCalledTimes(2);
  });

  it("answers the door's PNG and warns when the page cannot decode it", async () => {
    const { registry, deps } = setup();
    deps.decode.mockRejectedValueOnce(new Error("[moku-editor] no canvas"));

    const ran = await run(registry, "editor.capture", { maxWidth: 540 });

    expect(ran.value).toMatchObject({ image: PNG });
    expect(deps.log.warn).toHaveBeenCalledWith("capture:encode-failed", {
      message: "[moku-editor] no canvas"
    });
  });
});

describe("editor.capture crop", () => {
  /** The page rect game.locate answers for "hud/infoBar". */
  const LOCATED = { x: 10, y: 20, w: 100, h: 50 };

  it("crops to the located rect of a key, scaled to the picture and padded", async () => {
    vi.stubGlobal("innerWidth", 540);
    vi.stubGlobal("innerHeight", 960);
    const registry = fakeRegistry(undefined, { sources: { "game.locate": () => LOCATED } });
    const { deps } = setup(registry);

    const ran = await run(registry, "editor.capture", { key: "hud/infoBar" });

    expect(registry.reads.get("game.locate")).toHaveBeenCalledWith({ key: "hud/infoBar" });
    expect(deps.decode.pictures[0]?.encode).toHaveBeenCalledWith({
      crop: { x: 4, y: 24, width: 232, height: 132 },
      size: { width: 232, height: 132 },
      format: "jpeg",
      quality: 0.8
    });
    expect(ran.value).toEqual({
      image: smallJpeg(232, 132),
      frame: 1778,
      device: { w: 540, h: 960, orientation: "portrait" }
    });
  });

  it("reads game.rect on a game 0.1", async () => {
    const registry = fakeRegistry(undefined, { sources: { "game.rect": () => LOCATED } });
    setup(registry);

    await run(registry, "editor.capture", { key: "board" });

    expect(registry.reads.get("game.rect")).toHaveBeenCalledWith({ key: "board" });
  });

  it("crops to a given rect, then downscales, with the asked quality", async () => {
    vi.stubGlobal("innerWidth", 540);
    vi.stubGlobal("innerHeight", 960);
    const { registry, deps } = setup();

    const ran = await run(registry, "editor.capture", {
      rect: LOCATED,
      maxWidth: 116,
      quality: 0.5
    });

    expect(deps.decode.pictures[0]?.encode).toHaveBeenCalledWith({
      crop: { x: 4, y: 24, width: 232, height: 132 },
      size: { width: 116, height: 66 },
      format: "jpeg",
      quality: 0.5
    });
    expect(ran.value).toMatchObject({ image: smallJpeg(116, 66) });
  });

  it("crops a png when asked", async () => {
    const { registry } = setup();

    const ran = await run(registry, "editor.capture", { rect: LOCATED, format: "png" });

    expect(ran.value).toMatchObject({ image: smallPng(116, 66) });
  });

  it("refuses an unknown key with -32602 before the door runs", async () => {
    const registry = fakeRegistry(undefined, { sources: { "game.locate": () => null } });
    setup(registry);

    expect(await rejectionOf(run(registry, "editor.capture", { key: "nope" }))).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", id: "editor.capture", field: "key" }
    });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("refuses a key when the game reports no element rects", async () => {
    const { registry } = setup();

    expect(await rejectionOf(run(registry, "editor.capture", { key: "hud" }))).toMatchObject({
      code: -32_602,
      data: { field: "key" }
    });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("refuses a malformed rect with -32602 before the door runs", async () => {
    const { registry } = setup();

    expect(
      await rejectionOf(run(registry, "editor.capture", { rect: { x: 0, y: 0, w: 0, h: 5 } }))
    ).toMatchObject({ code: -32_602, data: { field: "rect" } });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("refuses a rect outside the picture with -32602", async () => {
    const { registry } = setup();

    expect(
      await rejectionOf(run(registry, "editor.capture", { rect: { x: 4000, y: 0, w: 10, h: 10 } }))
    ).toMatchObject({ code: -32_602, data: { field: "rect" } });
  });

  it("answers the door's PNG uncropped and warns when the page cannot decode", async () => {
    const { registry, deps } = setup();
    deps.decode.mockRejectedValueOnce(new Error("[moku-editor] no createImageBitmap"));

    const ran = await run(registry, "editor.capture", { rect: LOCATED });

    expect(ran.value).toMatchObject({ image: PNG });
    expect(deps.log.warn).toHaveBeenCalledWith("capture:encode-failed", {
      message: "[moku-editor] no createImageBitmap"
    });
  });
});

describe("editor.capture format and quality", () => {
  it.each([
    [{ format: "webp" }, "format"],
    [{ quality: 0 }, "quality"],
    [{ quality: 2 }, "quality"],
    [{ format: 1 }, "format"]
  ])("refuses %j with -32602 before the door runs", async (input, field) => {
    const { registry } = setup();

    expect(await rejectionOf(run(registry, "editor.capture", input))).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", field }
    });
    expect(registry.capture).not.toHaveBeenCalled();
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

describe("editor.sheet", () => {
  it("runs game.capture { sheet } once and answers the sheet, its frame and the device", async () => {
    const { registry, deps } = setup(fakeRegistry(() => ({ value: { png: PNG } })));

    const ran = await run(registry, "editor.sheet", { frames: 6, everyMs: 500, format: "png" });

    expect(registry.capture).toHaveBeenCalledOnce();
    expect(registry.capture).toHaveBeenCalledWith({ sheet: { frames: 6, everyMs: 500 } });
    expect(ran).toEqual({
      value: { image: PNG, frame: 1778, device: { w: 0, h: 0, orientation: "portrait" } },
      state: { ...ENVELOPE, frame: 1778 }
    });
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("takes the PNG data URL itself (the pictureOf rule of game 0.1)", async () => {
    const { registry } = setup();

    const ran = await run(registry, "editor.sheet", { frames: 2, everyMs: 1, format: "png" });

    expect(ran.value).toMatchObject({ image: PNG });
  });

  it("downscales the sheet to maxWidth with the page decoder, keeping the aspect", async () => {
    const deps = { ...createDeps(fakeClock()), decode: fakeDecoder(3240, 3840) };
    const { registry } = setup(
      fakeRegistry(() => ({ value: { png: PNG } })),
      deps
    );

    const ran = await run(registry, "editor.sheet", { frames: 6, everyMs: 100, maxWidth: 1080 });

    expect(ran.value).toMatchObject({ image: smallJpeg(1080, 1280), frame: 1778 });
    expect(deps.decode).toHaveBeenCalledWith(PNG);
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it("answers the full sheet and warns when the page cannot downscale it", async () => {
    const { registry, deps } = setup();
    deps.decode.mockRejectedValueOnce(new Error("[moku-editor] no canvas"));

    const ran = await run(registry, "editor.sheet", { frames: 4, everyMs: 100, maxWidth: 540 });

    expect(ran.value).toMatchObject({ image: PNG });
    expect(deps.log.warn).toHaveBeenCalledWith("capture:encode-failed", {
      message: "[moku-editor] no canvas"
    });
  });

  it.each([
    ["frames", { frames: 1, everyMs: 100 }, "frames must be a whole number from 2 to 12"],
    ["frames", { frames: 13, everyMs: 100 }, "frames must be a whole number from 2 to 12"],
    ["frames", { frames: 2.5, everyMs: 100 }, "frames must be a whole number from 2 to 12"],
    ["everyMs", { frames: 6, everyMs: 0 }, "everyMs must be a number from 1 to 5000"],
    ["everyMs", { frames: 6, everyMs: 5001 }, "everyMs must be a number from 1 to 5000"],
    ["everyMs", { frames: 6, everyMs: -5 }, "everyMs must be a number from 1 to 5000"]
  ])("refuses %s out of range with -32602 before the door runs (%j)", async (field, input, text) => {
    const { registry } = setup();

    const error = await rejectionOf(run(registry, "editor.sheet", input));

    expect(error).toMatchObject({
      code: -32_602,
      message: expect.stringContaining(`[moku-editor] editor.sheet: ${text}.`),
      data: { reason: "invalid_input", retryable: false, id: "editor.sheet", field }
    });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("refuses a maxWidth out of range naming editor.sheet", async () => {
    const { registry } = setup();

    expect(
      await rejectionOf(run(registry, "editor.sheet", { frames: 6, everyMs: 100, maxWidth: 32 }))
    ).toMatchObject({
      code: -32_602,
      message:
        "[moku-editor] editor.sheet: maxWidth must be a whole number from 64 to 4096.\n  Pass the widest picture you want, in pixels.",
      data: { reason: "invalid_input", id: "editor.sheet", field: "maxWidth" }
    });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("checks the input against its schema", async () => {
    const { registry } = setup();

    expect(await rejectionOf(run(registry, "editor.sheet", { frames: 6 }))).toMatchObject({
      code: -32_602,
      data: { field: "everyMs" }
    });
    expect(
      await rejectionOf(run(registry, "editor.sheet", { frames: 6, everyMs: 100, legend: true }))
    ).toMatchObject({ code: -32_602, data: { field: "legend" } });
  });

  it("rejects -32000 naming editor.sheet when the door gives no picture", async () => {
    const { registry } = setup(fakeRegistry(() => ({ value: null })));

    expect(
      await rejectionOf(run(registry, "editor.sheet", { frames: 6, everyMs: 100 }))
    ).toMatchObject({
      code: -32_000,
      message:
        "[moku-editor] game.capture gave no picture.\n  The renderer is inert, headless or this is not a dev build.",
      data: { reason: "command_failed", id: "editor.sheet" }
    });
  });

  it("passes the format and quality through to the encoder", async () => {
    const { registry, deps } = setup();

    await run(registry, "editor.sheet", { frames: 4, everyMs: 100, format: "jpeg", quality: 0.4 });

    expect(deps.decode.pictures[0]?.encode).toHaveBeenCalledWith({
      size: { width: 1080, height: 1920 },
      format: "jpeg",
      quality: 0.4
    });
  });

  it("refuses a format out of range naming editor.sheet before the door runs", async () => {
    const { registry } = setup();

    expect(
      await rejectionOf(run(registry, "editor.sheet", { frames: 4, everyMs: 100, format: "gif" }))
    ).toMatchObject({ code: -32_602, data: { id: "editor.sheet", field: "format" } });
    expect(registry.capture).not.toHaveBeenCalled();
  });

  it("passes an error of the door through unchanged", async () => {
    const refused = new Error("[game] a sheet comes with layers only.");
    const { registry } = setup(fakeRegistry(() => ({ error: refused })));

    expect(await rejectionOf(run(registry, "editor.sheet", { frames: 6, everyMs: 100 }))).toBe(
      refused
    );
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
