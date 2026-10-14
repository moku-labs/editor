/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistryApi } from "../../api";
import { buildCatalogue } from "../../catalogue";
import { doorFailed, readOnlyRefusal } from "../../entries/failures";
import { withRunEvent } from "../../entries/run-event";
import type { CommandDescriptor, Json } from "../../protocol";
import { checkInput } from "../../protocol";
import type { CommandEntry } from "../../types";
import type { EmitMock, LogMock } from "../helpers";
import { createCtx, createEmit, createLog, startBareGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// withRunEvent: one registry:command per settled run, whoever ran it
// ─────────────────────────────────────────────────────────────────────────────

const descriptor: CommandDescriptor = {
  id: "garden.glow",
  title: "Glow",
  input: { on: "boolean" },
  effect: "cosmetic",
  allowed: true
};
const state = { path: "garden/boss", frame: 4812, tainted: false };

let log: LogMock;
let emit: EmitMock;

beforeEach(() => {
  log = createLog();
  emit = createEmit();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Wraps an entry with the given run.
 *
 * @param run - The inner run.
 * @returns The wrapped entry.
 */
const wrapped = (run: CommandEntry["run"]): CommandEntry =>
  withRunEvent({ descriptor, run }, emit, log);

/** An inner run that checks its input like a door entry and answers the switch. */
const glowRun: CommandEntry["run"] = async raw => {
  const { on } = checkInput({ on: "boolean" }, raw);
  return { value: on, state };
};

describe("withRunEvent", () => {
  it("emits one registry:command with via local when a run resolves", async () => {
    await expect(wrapped(glowRun).run({ on: false })).resolves.toEqual({ value: false, state });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("registry:command", {
      id: "garden.glow",
      input: { on: false },
      via: "local",
      ok: true
    });
  });

  it("carries the via the caller names", async () => {
    const entry = wrapped(glowRun);

    await entry.run({ on: true }, "overlay");
    await entry.run({ on: true }, "bridge");

    expect(emit.mock.calls.map(([, event]) => event.via)).toEqual(["overlay", "bridge"]);
  });

  it("records null as the input of a call without one", async () => {
    // boundary of the test: a JavaScript caller that passes nothing
    await wrapped(async () => ({ value: null, state })).run(undefined as unknown as Json);

    expect(emit).toHaveBeenCalledWith("registry:command", expect.objectContaining({ input: null }));
  });

  it.each([
    ["a failed run", doorFailed("garden.glow", "no garden")],
    ["a read-only refusal", readOnlyRefusal("garden.glow")]
  ])("emits ok: false for %s and rejects with the same error", async (_label, error) => {
    await expect(wrapped(() => Promise.reject(error)).run({ on: true })).rejects.toBe(error);

    expect(emit).toHaveBeenCalledWith("registry:command", {
      id: "garden.glow",
      input: { on: true },
      via: "local",
      ok: false
    });
  });

  it("emits nothing for an input the check refuses: -32602 is not a run", async () => {
    await expect(wrapped(glowRun).run({ on: "yes" })).rejects.toMatchObject({ code: -32_602 });

    expect(emit).not.toHaveBeenCalled();
  });

  it("logs registry:emit-failed when a hook throws and still hands the caller its result", async () => {
    emit.mockImplementation(() => {
      throw new Error("recorder is full");
    });
    const failure = doorFailed("garden.glow", "no garden");

    await expect(wrapped(glowRun).run({ on: true })).resolves.toEqual({ value: true, state });
    await expect(wrapped(() => Promise.reject(failure)).run(null)).rejects.toBe(failure);
    expect(log.warn).toHaveBeenCalledWith("registry:emit-failed", {
      id: "garden.glow",
      message: "recorder is full"
    });
  });

  it("keeps the descriptor and the value() of the entry it wraps", () => {
    const entry = withRunEvent({ descriptor, run: glowRun, value: () => true }, emit, log);

    expect(entry.descriptor).toBe(descriptor);
    expect(entry.value?.()).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it("wraps the door commands of the catalogue and the editor commands of add", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const game = await startBareGame();
    const ctx = createCtx({ game: game.app });
    const registry = createRegistryApi(ctx);
    buildCatalogue(ctx);
    registry.add({
      descriptor: { id: "editor.ping", title: "Ping", input: {}, effect: "read" },
      run: async () => ({ value: "pong", state: registry.envelope() })
    });

    await registry.command("game.pause")?.run(null, "bridge");
    await registry.command("editor.ping")?.run(null);
    await game.stop();

    expect(ctx.emit.mock.calls).toEqual([
      ["registry:command", { id: "game.pause", input: null, via: "bridge", ok: true }],
      ["registry:command", { id: "editor.ping", input: null, via: "local", ok: true }]
    ]);
  });
});
