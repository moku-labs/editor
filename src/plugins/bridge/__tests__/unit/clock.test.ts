/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import { describe, expect, expectTypeOf, it } from "vitest";
import { isJson } from "../../../registry/protocol";
import type { Clock, CommandEntry } from "../../../registry/types";
import { clockEntry } from "../../clock";
import { createDeps, ENVELOPE, rejectionOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// editor.clock (change reload-background-pause): the read-only command that
// answers registry.clock(), so the tools side can tell the pause the developer
// holds (devtools) from the pause of a hidden tab (background).
// ─────────────────────────────────────────────────────────────────────────────

describe("clockEntry", () => {
  it("describes a read command without input", () => {
    const { registry } = createDeps();

    expect(clockEntry(registry).descriptor).toEqual({
      id: "editor.clock",
      title: "Clock",
      input: {},
      effect: "read"
    });
  });

  it("is a registry command entry", () => {
    expectTypeOf(clockEntry).returns.toEqualTypeOf<CommandEntry>();
    expectTypeOf(clockEntry).parameter(0).toHaveProperty("clock");
    expectTypeOf(clockEntry).parameter(0).toHaveProperty("envelope");
    expect(clockEntry).toHaveLength(1);
  });

  it("answers the clock of a running game with the registry envelope", async () => {
    const { registry } = createDeps();

    expect(await clockEntry(registry).run(null)).toEqual({
      value: { frame: 12, paused: false, held: false, reasons: [] },
      state: ENVELOPE
    });
  });

  it.each<{ name: string; clock: Clock }>([
    {
      name: "a hidden tab: paused, not held",
      clock: { frame: 1840, paused: true, held: false, reasons: ["background"] }
    },
    {
      name: "a devtools pause: held",
      clock: { frame: 1840, paused: true, held: true, reasons: ["devtools"] }
    },
    {
      name: "a devtools pause in a hidden tab: held, both reasons in push order",
      clock: { frame: 1840, paused: true, held: true, reasons: ["background", "devtools"] }
    },
    {
      name: "a paused game without lifecycle.reasons: held, no reasons",
      clock: { frame: 7, paused: true, held: true, reasons: [] }
    }
  ])("answers $name", async ({ clock }) => {
    const { registry } = createDeps();
    registry.clockValue = clock;

    const ran = await clockEntry(registry).run({});

    expect(ran.value).toEqual({ ...clock });
    expect(ran.state).toBe(ENVELOPE);
  });

  it("reads the clock at every run, not when the entry is built", async () => {
    const { registry } = createDeps();
    const entry = clockEntry(registry);

    registry.clockValue = { frame: 13, paused: true, held: true, reasons: ["devtools"] };
    const held = await entry.run(null);
    registry.clockValue = { frame: 14, paused: false, held: false, reasons: [] };
    const free = await entry.run(null);

    expect(held.value).toEqual({ frame: 13, paused: true, held: true, reasons: ["devtools"] });
    expect(free.value).toEqual({ frame: 14, paused: false, held: false, reasons: [] });
  });

  it("answers a Json value of its own: a later push on the game's reasons does not reach it", async () => {
    const { registry } = createDeps();
    const reasons = ["background"];
    registry.clockValue = { frame: 3, paused: true, held: false, reasons };

    const ran = await clockEntry(registry).run(null);
    reasons.push("devtools");

    expect(ran.value).toEqual({ frame: 3, paused: true, held: false, reasons: ["background"] });
    expect(isJson(ran.value)).toBe(true);
  });

  it("rejects, and never throws at the call, when the registry has no game", async () => {
    const { registry } = createDeps();
    registry.clock = () => {
      throw new Error("[moku-editor] registry.game is missing.");
    };

    const ran = clockEntry(registry).run(null);

    expect(await rejectionOf(ran)).toMatchObject({
      message: "[moku-editor] registry.game is missing."
    });
  });
});
