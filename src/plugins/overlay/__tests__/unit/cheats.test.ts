import { describe, expect, it } from "vitest";
import type { RunResult } from "../../../registry/protocol";
import { wireError } from "../../../registry/protocol";
import { cheatCommands, runCheat } from "../../cheats";
import { command, createOctx, manifestOf } from "../helpers";

describe("cheatCommands", () => {
  it("keeps only cheat effects, in manifest order", () => {
    const manifest = manifestOf([
      command("b.cheat"),
      command("game.step", "route", { frames: "number" }),
      command("a.cheat"),
      command("editor.overlay", "cosmetic", { on: "boolean" }),
      command("game.restore", "raw"),
      command("game.read", "read")
    ]);

    expect(cheatCommands(manifest).map(descriptor => descriptor.id)).toEqual([
      "b.cheat",
      "a.cheat"
    ]);
  });

  it("leaves out cheats with a required input field", () => {
    const manifest = manifestOf([
      command("a.empty"),
      command("a.optional", "cheat", { amount: "number?", note: "string?" }),
      command("a.required", "cheat", { amount: "number" }),
      command("a.mixed", "cheat", { amount: "number?", who: "string" })
    ]);

    expect(cheatCommands(manifest).map(descriptor => descriptor.id)).toEqual([
      "a.empty",
      "a.optional"
    ]);
  });

  it("answers an empty list without cheats", () => {
    expect(cheatCommands(manifestOf([]))).toEqual([]);
  });
});

describe("runCheat", () => {
  it("marks the cheat busy while it runs, then records ok", async () => {
    const octx = createOctx();
    const settled = Promise.withResolvers<RunResult>();
    octx.channel.answer = () => settled.promise;

    const running = runCheat(octx, "a.one");
    expect(octx.state.busy.has("a.one")).toBe(true);
    settled.resolve({ value: true, state: { path: "p", frame: 1, tainted: true } });
    await running;

    expect(octx.state.busy.has("a.one")).toBe(false);
    expect(octx.state.results.get("a.one")).toMatchObject({ ok: true, message: undefined });
    expect(octx.channel.runs).toEqual(["a.one"]);
  });

  it("ignores a second click while busy", async () => {
    const octx = createOctx();
    const first = runCheat(octx, "a.one");
    const second = runCheat(octx, "a.one");
    await Promise.all([first, second]);

    expect(octx.channel.runs).toEqual(["a.one"]);
  });

  it("records an error with the bare message and logs overlay:cheat-failed", async () => {
    const octx = createOctx();
    octx.channel.answer = () =>
      Promise.reject(wireError(-32_000, "merge.addCoins: no wallet", { reason: "command_failed" }));

    await runCheat(octx, "merge.addCoins");

    expect(octx.state.results.get("merge.addCoins")).toMatchObject({
      ok: false,
      message: "merge.addCoins: no wallet"
    });
    expect(octx.state.busy.size).toBe(0);
    expect(octx.log.warn).toHaveBeenCalledWith("overlay:cheat-failed", {
      id: "merge.addCoins",
      code: -32_000,
      message: "[moku-editor] merge.addCoins: no wallet"
    });
  });

  it("records a plain thrown error as command failed", async () => {
    const octx = createOctx();
    octx.channel.answer = () => Promise.reject(new Error("boom"));

    await runCheat(octx, "a.one");

    expect(octx.state.results.get("a.one")?.message).toBe("boom");
    expect(octx.log.warn).toHaveBeenCalledWith("overlay:cheat-failed", {
      id: "a.one",
      code: -32_000,
      message: "[moku-editor] boom"
    });
  });
});
