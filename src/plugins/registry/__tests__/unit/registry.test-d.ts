import type { Command } from "@moku-labs/game/control";
import { defineCommand } from "@moku-labs/game/control";
import { describe, expectTypeOf, it } from "vitest";
import type { AgentEvents } from "../../../../config";
import { createAgentPlugin } from "../../../../config";
import { registryPlugin } from "../..";
import type {
  CommandEntry,
  DoorCommand,
  GameLike,
  RegistryApi,
  RegistryCommandEvent,
  SourceEntry
} from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level contract of the registry (checked by tsc): the add union, the
// DoorCommand overlay members, and the per-plugin event registry:command
// ─────────────────────────────────────────────────────────────────────────────

declare const registry: RegistryApi;

/** A game toggle of the engine's overlay union (spec 12 H4.4): input `{ on: "boolean" }` and `value(app)`. */
const glow = defineCommand({
  id: "garden.glow",
  title: "Glow",
  input: { on: "boolean" },
  effect: "cosmetic",
  overlay: "toggle",
  value: (app: GameLike) => app.time.isPaused(),
  run: (_app: GameLike, { on }) => on
});

/** A game button of the engine's overlay union: no required input, no value. */
const boss = defineCommand({
  id: "garden.boss",
  title: "Boss fight",
  input: {},
  effect: "route",
  overlay: "button",
  run: () => true
});

describe("registry types", () => {
  it("add takes a command entry or a source entry, and nothing with neither run nor read", () => {
    expectTypeOf(registry.add).parameter(0).toEqualTypeOf<CommandEntry | SourceEntry>();

    // @ts-expect-error -- an entry needs run (a command) or read and watch (a source)
    registry.add({ descriptor: { id: "editor.x", title: "X", input: {}, effect: "read" } });
  });

  it("takes every branch of the engine's Command union as a DoorCommand: none, toggle, button", () => {
    expectTypeOf<Command<{ frames: "number" }, unknown, GameLike>>().toExtend<DoorCommand>();
    expectTypeOf<Command<{ on: "boolean" }, boolean, GameLike>>().toExtend<DoorCommand>();
    expectTypeOf(glow).toExtend<DoorCommand>();
    expectTypeOf(boss).toExtend<DoorCommand>();
  });

  it("refuses an unknown overlay marker on a DoorCommand", () => {
    const slider = {
      id: "garden.glow",
      title: "Glow",
      input: {},
      effect: "cosmetic",
      overlay: "slider",
      run: () => true
    } as const;

    // @ts-expect-error -- "slider" is not "toggle" | "button"
    const door: DoorCommand = slider;
    expectTypeOf(door).toEqualTypeOf<DoorCommand>();
  });

  it("hooks registry:command, typed RegistryCommandEvent, in a plugin that depends on the registry", () => {
    createAgentPlugin("recorderLike", {
      depends: [registryPlugin],
      hooks: () => ({
        "registry:command": payload => {
          expectTypeOf(payload).toEqualTypeOf<RegistryCommandEvent>();
        }
      })
    });
  });

  it("keeps registry:command out of AgentEvents and out of a plugin without that depends", () => {
    expectTypeOf<
      "registry:command" extends keyof AgentEvents ? true : false
    >().toEqualTypeOf<false>();

    createAgentPlugin("stranger", {
      // @ts-expect-error -- registry:command reaches only plugins that depend on the registry
      hooks: () => ({ "registry:command": () => undefined })
    });
  });
});
