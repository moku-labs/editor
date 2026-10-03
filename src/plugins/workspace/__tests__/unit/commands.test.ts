import { describe, expect, it } from "vitest";
import { wireError } from "../../../registry/protocol";
import { runCommand } from "../../commands";
import { createCtx, resultOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// runCommand: link.run, one workspace:ran with the origin, the D1 result
// ─────────────────────────────────────────────────────────────────────────────

describe("runCommand", () => {
  it("resolves like link.run and emits one workspace:ran ok with the origin", async () => {
    const ctx = createCtx();
    const result = resultOf({ stepped: 1 });
    ctx.link.run.mockResolvedValue(result);

    await expect(runCommand(ctx, "game.pause", undefined, "topbar")).resolves.toBe(result);
    expect(ctx.link.run).toHaveBeenCalledWith("game.pause", undefined);
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:ran", {
      id: "game.pause",
      input: undefined,
      origin: "topbar",
      at: expect.any(Number),
      ok: true,
      result
    });
  });

  it("rejects like link.run and emits ok: false with the WireError", async () => {
    const ctx = createCtx();
    const error = wireError(-32_602, "game.step: frames must be a number", {
      reason: "invalid_input",
      retryable: false,
      field: "frames"
    });
    ctx.link.run.mockRejectedValue(error);

    await expect(runCommand(ctx, "game.step", { frames: "x" }, "key")).rejects.toBe(error);
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:ran", {
      id: "game.step",
      input: { frames: "x" },
      origin: "key",
      at: expect.any(Number),
      ok: false,
      error: {
        code: -32_602,
        message: "[moku-editor] game.step: frames must be a number",
        data: { reason: "invalid_input", retryable: false, field: "frames" }
      }
    });
  });

  it("a plain Error becomes a -32000 command_failed WireError", async () => {
    const ctx = createCtx();
    ctx.link.run.mockRejectedValue(new Error("boom"));
    await expect(runCommand(ctx, "game.resume", undefined, "palette")).rejects.toThrow("boom");
    expect(ctx.emit.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: -32_000, message: "[moku-editor] boom" }
    });
  });

  it("a game.step run feeds the D1 step popover; other ids do not", async () => {
    const ctx = createCtx();
    const bump = ctx.state.ui.version;
    await runCommand(ctx, "game.pause", undefined, "topbar");
    expect(ctx.state.step).toBeUndefined();
    expect(ctx.state.popover).toBeUndefined();

    await runCommand(ctx, "game.step", { frames: 1 }, "topbar");
    expect(ctx.state.step).toMatchObject({ id: "game.step", ok: true });
    expect(ctx.state.popover).toBe("step");
    expect(ctx.state.ui.version).toBeGreaterThan(bump);

    ctx.link.run.mockRejectedValue(wireError(-32_602, "bad"));
    await expect(runCommand(ctx, "game.step", { frames: 1 }, "key")).rejects.toThrow("bad");
    expect(ctx.state.step).toMatchObject({ ok: false, error: { code: -32_602 } });
  });
});
