import { afterEach, describe, expect, it } from "vitest";
import { logErrors, paramsOf, type Stack, shutdown, startStack, TINY_NAME } from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// The helper proves itself: the server stack, an agent on the tiny game and the
// tools app go live over the real wire, one command runs end to end through
// the hub, and everything stops within bounds.
// ─────────────────────────────────────────────────────────────────────────────

let stack: Stack | undefined;

afterEach(async () => {
  await shutdown(stack);
  stack = undefined;
});

describe("root integration helper", () => {
  it("boots the stack live, runs game.answer through the hub and shuts down in bounds", async () => {
    stack = await startStack();
    const { server, agent, tools, game } = stack;

    const manifest = tools.app.link.manifest();
    expect(manifest?.game).toBe(TINY_NAME);
    expect(manifest?.embedded).toBe(true);
    expect(tools.app.link.session()).toBe(server.app.hub.sessions()[0]?.id);
    expect(agent.statuses.at(-1)?.status.kind).toBe("live");
    expect(server.sessions).toMatchObject([{ open: true, game: TINY_NAME }]);

    const ran = await tools.app.link.run("game.answer", { intent: "play" });

    expect(ran.state).toMatchObject({ path: "home", tainted: false });
    expect(game.app.model.store.snapshot().player).toEqual({ coins: 5, visits: 1 });
    const runs = server.tap.requests("tools", "run").map(message => paramsOf(message)?.id);
    expect(runs).toEqual(["game.answer"]);
    expect(server.tap.sent("agent", "run").map(message => paramsOf(message)?.id)).toEqual([
      "game.answer"
    ]);
    expect(tools.eventsOf("link:status").at(-1)?.status.kind).toBe("live");
    // The tiny game has no screen and no effects plugin: game.render, game.assets, game.effects,
    // game.ui, game.entities and game.projections are not installed. The agent probes them at
    // start and answers -32008 not_installed, which the link does not log. Nothing errs.
    expect(logErrors(server.app, agent.app, tools.app, game.app)).toEqual([]);

    const started = performance.now();
    await shutdown(stack);
    stack = undefined;
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
