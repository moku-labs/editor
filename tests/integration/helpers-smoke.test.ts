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
    // The tiny game has no screen and no effects plugin: game.render, game.assets and
    // game.effects, which renderView watches for the session, and game.ui, game.entities and
    // game.projections, which gameView watches while Game (the default workspace) is shown, fail
    // to read. The link logs each once at error level. Nothing else errs.
    const errors = logErrors(server.app, agent.app, tools.app, game.app);
    expect(errors).toHaveLength(6);
    expect(errors).toEqual(
      expect.arrayContaining(
        [
          "game.render",
          "game.assets",
          "game.effects",
          "game.ui",
          "game.entities",
          "game.projections"
        ].map(id =>
          expect.objectContaining({
            event: "link:watch-failed",
            data: expect.objectContaining({ id })
          })
        )
      )
    );

    const started = performance.now();
    await shutdown(stack);
    stack = undefined;
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
