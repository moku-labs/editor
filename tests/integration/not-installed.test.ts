import type { Log } from "@moku-labs/common/browser";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Logged,
  logErrors,
  type Stack,
  settle,
  shutdown,
  startStack,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// A game without the effects plugin, end to end over the real wire: the tiny
// game is made from the engine's core plugins only, so game.effects (and the
// screen sources) are not installed. The agent probes them once at start, the
// manifest says so, every read and watch answers -32008, and nothing logs a
// failure: no registry:source-failed, registry:watch-failed or link:watch-failed.
// ─────────────────────────────────────────────────────────────────────────────

let stack: Stack | undefined;

afterEach(async () => {
  await shutdown(stack);
  stack = undefined;
});

/** The log events a missing game plugin used to cause on every load. */
const FAILURE_EVENTS: ReadonlySet<string> = new Set([
  "registry:source-failed",
  "registry:watch-failed",
  "link:watch-failed"
]);

/**
 * Every trace entry of the apps.
 *
 * @param apps - The apps to read.
 * @returns Their entries, app by app.
 */
function entriesOf(...apps: readonly Logged[]): Log.LogEntry[] {
  return apps.flatMap(app => app.log.trace());
}

/**
 * The `id` of a log entry's data, if any.
 *
 * @param entry - A log entry.
 * @returns The id.
 */
function idOf(entry: Log.LogEntry): unknown {
  const data: { readonly id?: unknown } = entry.data ?? {};
  return data.id;
}

describe("a game without the effects plugin", () => {
  it("lists game.effects as not installed and answers -32008, with no failure logs", async () => {
    stack = await startStack();
    const { server, agent, tools, game } = stack;
    const apps = [server.app, agent.app, tools.app, game.app];

    const effects = tools.app.link.manifest()?.sources.find(source => source.id === "game.effects");
    expect(effects).toMatchObject({ available: false, reason: expect.any(String) });
    expect(
      tools.app.link.manifest()?.sources.find(source => source.id === "game.position")
    ).not.toHaveProperty("available");

    await expect(tools.app.link.read("game.effects")).rejects.toMatchObject({
      code: -32_008,
      message: expect.stringMatching(
        /^\[moku-editor] source game\.effects is not available in this game: /
      ),
      data: { reason: "not_installed", retryable: false }
    });

    // Render and Game watch the screen sources; each is refused once, quietly.
    tools.app.workspace.show("render");
    const host = tools.app.workspace.host("render");
    await until(
      () => host.querySelector('[data-panel="render"][data-panel-state="ready"]') !== null,
      "the render panel ready"
    );
    await until(
      () => tools.app.renderView.snapshot().tiles.effectsInstalled === false,
      "renderView to know game.effects is not installed"
    );
    tools.app.workspace.show("game");
    await game.frames(3);
    await settle();

    expect(host.querySelector("[data-tile='scene'] [data-note]")?.textContent).toBe(
      "Effects not installed in this game"
    );
    expect(entriesOf(...apps).filter(entry => FAILURE_EVENTS.has(entry.event))).toEqual([]);
    expect(logErrors(...apps)).toEqual([]);
    expect(
      entriesOf(agent.app).filter(
        entry => entry.event === "registry:source-unavailable" && idOf(entry) === "game.effects"
      )
    ).toHaveLength(1);
  });
});
