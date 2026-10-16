import { afterEach, describe, expect, it } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { GameLike } from "../../../registry/types";
import { perfPlugin } from "../..";
import type { PerfFeeds } from "../../protocol";
import type { PerfConfig } from "../../types";
import { startedGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// perf's feed switches (spec 03 Delta 2026-10-16 D7): three flat booleans,
// merged by the kernel's shallow config merge, checked at createApp.
// ─────────────────────────────────────────────────────────────────────────────

const { createApp } = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, perfPlugin] });

/** What each test stops. */
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/**
 * The feeds an agent app with this perf config reads, as `editor.perf.sections {}` answers them.
 *
 * @param perf - perf's config overrides.
 * @returns The feeds.
 */
async function feedsOf(perf: Partial<PerfConfig>): Promise<PerfFeeds | undefined> {
  const game = await startedGame();
  stops.push(() => game.stop());
  const grafted: GameLike = Object.create(game.app, {
    renderer: { value: { monitor: createFakeMonitor() } }
  });
  const editor = createApp({ pluginConfigs: { registry: { game: grafted }, perf } });
  const answer = await editor.registry.command("editor.perf.sections")?.run({});
  return (answer?.value as { feeds?: PerfFeeds } | undefined)?.feeds;
}

describe("perf's feed config", () => {
  it("reads no passes, the top 5 systems and no nodes by default, as the engine's sections", async () => {
    expect(await feedsOf({})).toEqual({ passes: false, systems: true, nodes: false });
  });

  it("keeps the other two switches when one is given (bug: a nested feeds object merged shallowly, dropping systems and nodes)", async () => {
    expect(await feedsOf({ feedPasses: true })).toEqual({
      passes: true,
      systems: true,
      nodes: false
    });
  });

  it.each([
    ["feedPasses", "passes"],
    ["feedSystems", "systems"],
    ["feedNodes", "nodes"]
  ] as const)("throws the two-line TypeError at createApp for a %s that is not a boolean", async (key, what) => {
    const game = await startedGame();
    stops.push(() => game.stop());
    const perf = { [key]: "yes" } as unknown as Partial<PerfConfig>;
    expect(() => createApp({ pluginConfigs: { registry: { game: game.app }, perf } })).toThrow(
      new TypeError(
        `[moku-editor] perf.${key} is yes.\n  Give true or false; false reads no ${what}.`
      )
    );
  });
});
