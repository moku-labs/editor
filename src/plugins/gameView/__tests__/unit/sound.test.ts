// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { errorCode } from "../../../registry/protocol";
import { canMute, MUTE_COMMAND, NO_MUTE_TEXT, reapplyMute, setSound } from "../../sound";
import { createCtx, flush, manifestOf, type TestCtx } from "../helpers";

let ctx: TestCtx;

/** A manifest that lists game.mute. */
const WITH_MUTE = manifestOf([
  ["editor.capture", "read"],
  ["game.mute", "cosmetic"]
]);

beforeEach(() => {
  ctx = createCtx();
  ctx.link.manifestValue = WITH_MUTE;
});

describe("canMute (round 2b R11)", () => {
  it("is true only when the manifest lists game.mute", () => {
    expect(MUTE_COMMAND).toBe("game.mute");
    expect(canMute(ctx)).toBe(true);
    ctx.link.manifestValue = manifestOf();
    expect(canMute(ctx)).toBe(false);
    ctx.link.manifestValue = undefined;
    expect(canMute(ctx)).toBe(false);
    expect(NO_MUTE_TEXT).toBe("Needs @moku-labs/game with game.mute");
  });
});

describe("setSound (round 2b R11)", () => {
  it("toggles: runs game.mute { muted } through panels, then keeps the flag in workspace", async () => {
    expect(await setSound(ctx)).toBe(true);
    expect(ctx.panels.run).toHaveBeenCalledWith("game.mute", { muted: true });
    expect(ctx.workspace.setMuted).toHaveBeenCalledWith(true);
    expect(ctx.workspace.mutedValue).toBe(true);

    expect(await setSound(ctx)).toBe(true);
    expect(ctx.panels.run).toHaveBeenLastCalledWith("game.mute", { muted: false });
    expect(ctx.workspace.mutedValue).toBe(false);
  });

  it("sets the wanted value when given one", async () => {
    await setSound(ctx, true);
    await setSound(ctx, true);
    expect(ctx.panels.run.mock.calls).toEqual([
      ["game.mute", { muted: true }],
      ["game.mute", { muted: true }]
    ]);
  });

  it("does nothing without game.mute in the manifest", async () => {
    ctx.link.manifestValue = manifestOf();
    expect(await setSound(ctx)).toBe(false);
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.workspace.setMuted).not.toHaveBeenCalled();
  });

  it("keeps the flag when the game refuses, and toasts the bare message", async () => {
    ctx.panels.answers.set("game.mute", {
      code: errorCode.commandFailed,
      message: "[moku-editor] audio is off."
    });
    expect(await setSound(ctx)).toBe(false);
    expect(ctx.workspace.setMuted).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Sound switch failed · audio is off.");
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "gameView: mute failed",
      expect.objectContaining({ code: errorCode.commandFailed })
    );
  });
});

describe("reapplyMute (round 2b R11)", () => {
  it("mutes a game that connects while the viewer has the sound off", async () => {
    ctx.workspace.mutedValue = true;
    reapplyMute(ctx, WITH_MUTE);
    await flush();
    expect(ctx.panels.run).toHaveBeenCalledWith("game.mute", { muted: true });
  });

  it("sends nothing with the sound on, without a manifest or without game.mute", async () => {
    reapplyMute(ctx, WITH_MUTE);
    ctx.workspace.mutedValue = true;
    reapplyMute(ctx, undefined);
    reapplyMute(ctx, manifestOf());
    await flush();
    expect(ctx.panels.run).not.toHaveBeenCalled();
  });

  it("logs a refusal and toasts nothing", async () => {
    ctx.workspace.mutedValue = true;
    ctx.panels.answers.set("game.mute", {
      code: errorCode.commandFailed,
      message: "[moku-editor] audio is off."
    });
    reapplyMute(ctx, WITH_MUTE);
    await flush();
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "gameView: mute failed",
      expect.objectContaining({ code: errorCode.commandFailed })
    );
  });
});
