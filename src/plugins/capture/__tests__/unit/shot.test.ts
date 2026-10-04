/* eslint-disable unicorn/no-null -- null is the wire value the door answers when inert */
import { describe, expect, it } from "vitest";
import { takeShot } from "../../shot";
import { ENVELOPE, fakeRegistry, PNG, rejectionOf } from "../helpers";

describe("takeShot", () => {
  it("answers the data URL and the state game.capture ran with", async () => {
    const registry = fakeRegistry();

    const shot = await takeShot(registry);

    expect(shot).toEqual({ image: PNG, state: { ...ENVELOPE, frame: 1778 } });
    expect(registry.capture).toHaveBeenCalledWith({});
  });

  it("rejects -32601 when game.capture is not in the registry", async () => {
    const error = await rejectionOf(takeShot(fakeRegistry(undefined, { withCapture: false })));

    expect(error).toMatchObject({
      code: -32_601,
      message: "[moku-editor] game.capture is not in the registry.",
      data: { reason: "unknown_id", id: "game.capture" }
    });
  });

  it("answers the png of a game 0.4 answer { png, legend? }", async () => {
    const registry = fakeRegistry(() => ({ value: { png: PNG, legend: [] } }));

    expect(await takeShot(registry)).toEqual({ image: PNG, state: { ...ENVELOPE, frame: 1778 } });
  });

  it.each([
    ["null (inert renderer)", null],
    ["a string that is no image", "hello"],
    ["a number", 3],
    ["an object without png", { legend: [] }],
    ["an object whose png is no string", { png: 3 }],
    ["an object whose png is no image", { png: "hello" }],
    ["an array", [PNG]]
  ])("rejects -32000 when the door answers %s", async (_label, value) => {
    const error = await rejectionOf(takeShot(fakeRegistry(() => ({ value }))));

    expect(error).toMatchObject({
      code: -32_000,
      message:
        "[moku-editor] game.capture gave no picture.\n  The renderer is inert, headless or this is not a dev build.",
      data: { reason: "command_failed", id: "editor.capture" }
    });
  });

  it("lets an error of the door through unchanged", async () => {
    const boom = new Error("[moku-editor] game.capture: refused");

    expect(await rejectionOf(takeShot(fakeRegistry(() => ({ error: boom }))))).toBe(boom);
  });

  it("starts every own error message with the editor prefix", async () => {
    const errors = await Promise.all([
      rejectionOf(takeShot(fakeRegistry(undefined, { withCapture: false }))),
      rejectionOf(takeShot(fakeRegistry(() => ({ value: null }))))
    ]);

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(error instanceof Error && error.message.startsWith("[moku-editor] ")).toBe(true);
    }
  });
});
