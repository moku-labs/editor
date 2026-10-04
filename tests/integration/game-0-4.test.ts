import type { Log } from "@moku-labs/common/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Logged,
  logErrors,
  PNG_1X1,
  type Stack,
  shutdown,
  startStack,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// The editor on the doors of @moku-labs/game 0.4 (U11), end to end over the
// real wire. The installed game is 0.1 (the e2e fixture stays there), so the
// door set is swapped in this test: game.rect is gone and game.locate takes
// { key? , target? }; game.ui answers a two-node screen; game.capture answers
// { png } instead of the data URL itself. The picker calibrates from
// game.locate, and editor.capture, the Game Shot and the Series take the png.
// ─────────────────────────────────────────────────────────────────────────────

/** The fake 0.4 doors' values: hoisted, so the vi.mock factories can read them. */
const DOORS = vi.hoisted(() => {
  /** A real 1×1 PNG (equal to PNG_1X1): files.writeBinary decodes it. */
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const ui = {
    key: "homeScreen",
    type: "screen",
    rect: { x: 0, y: 0, w: 1080, h: 1920 },
    children: [
      { key: "play", type: "button", rect: { x: 340, y: 1200, w: 400, h: 120 }, children: [] }
    ]
  };
  /** game.locate of a key, in page px: the 1080-wide screen drawn 412 px wide. */
  const rects: Readonly<Record<string, { x: number; y: number; w: number; h: number }>> = {
    homeScreen: { x: 0, y: 0, w: 412, h: 732.4 }
  };
  return { png, ui, rects };
});

vi.mock("@moku-labs/game/inspect", async importOriginal => {
  const actual = await importOriginal<typeof import("@moku-labs/game/inspect")>();
  const kept = Object.fromEntries(
    Object.entries(actual.sources).filter(
      ([name]) => !["rect", "ui", "entities", "projections"].includes(name)
    )
  );
  const ui = actual.defineSource({
    id: "game.ui",
    title: "UI tree",
    input: {},
    changes: "frame",
    read: () => DOORS.ui
  });
  const entities = actual.defineSource({
    id: "game.entities",
    title: "Entities",
    input: {},
    changes: "frame",
    read: () => []
  });
  const projections = actual.defineSource({
    id: "game.projections",
    title: "Projections",
    input: {},
    changes: "frame",
    read: () => ({})
  });
  const locate = actual.defineSource({
    id: "game.locate",
    title: "Locate",
    input: { key: "string?", target: "json?" },
    changes: "frame",
    read: (_app, input) => {
      if (input.key !== undefined && input.target === undefined) return DOORS.rects[input.key];
      if (input.target !== undefined && input.key === undefined) return undefined;
      throw new Error(
        "[game] game.locate takes a key or a target.\n  Pass exactly one of { key } and { target }."
      );
    }
  });
  return {
    ...actual,
    sources: Object.freeze({ ...kept, ui, entities, projections, locate })
  };
});

vi.mock("@moku-labs/game/control", async importOriginal => {
  const actual = await importOriginal<typeof import("@moku-labs/game/control")>();
  const capture = actual.defineCommand({
    id: "game.capture",
    title: "Capture",
    input: { legend: "boolean?", layers: "json?", sheet: "json?", diff: "json?" },
    effect: "read",
    run: () => ({ png: DOORS.png })
  });
  return { ...actual, commands: Object.freeze({ ...actual.commands, capture }) };
});

let stack: Stack | undefined;

afterEach(async () => {
  await shutdown(stack);
  stack = undefined;
});

/** Log events that would mean a reader still asks game.rect or fails on the 0.4 doors. */
const FAILURE_EVENTS: ReadonlySet<string> = new Set([
  "registry:source-failed",
  "registry:watch-failed",
  "link:watch-failed",
  "gameView: calibration failed",
  "gameView: capture failed",
  "gameView: series failed"
]);

/**
 * The trace entries of the apps whose event is a failure.
 *
 * @param apps - The apps to read.
 * @returns The failure entries.
 */
function failuresOf(...apps: readonly Logged[]): Log.LogEntry[] {
  return apps.flatMap(app => app.log.trace()).filter(entry => FAILURE_EVENTS.has(entry.event));
}

describe("a game on the @moku-labs/game 0.4 doors", () => {
  it("lists game.locate, not game.rect, and never probes it", async () => {
    stack = await startStack();
    const sources = stack.tools.app.link.manifest()?.sources ?? [];

    expect(sources.map(source => source.id)).toContain("game.locate");
    expect(sources.map(source => source.id)).not.toContain("game.rect");
    expect(sources.find(source => source.id === "game.locate")).not.toHaveProperty("available");
  });

  it("the picker calibrates from game.locate", async () => {
    stack = await startStack();
    const { tools, server, agent, game } = stack;
    const { gameView, workspace } = tools.app;

    const scene = await gameView.scene();
    const scale = 412 / 1080;

    expect(scene.calibrated).toBe(true);
    const play = await gameView.locate({ kind: "ui", path: "homeScreen/play" });
    expect(play?.x).toBeCloseTo(340 * scale);
    expect(play?.y).toBeCloseTo(1200 * scale);
    expect(play?.w).toBeCloseTo(400 * scale);

    // The picker hint is the normal one: the game reports element rects.
    workspace.show("game");
    gameView.pick(true);
    const host = workspace.host("game");
    await until(
      () => host.querySelector("[data-game='stage'] [data-part='hint']") !== null,
      "the picker hint"
    );
    expect(host.querySelector("[data-game='stage'] [data-part='hint']")?.textContent).toBe(
      "Hover the game, click to select · Esc"
    );

    const apps = [server.app, agent.app, tools.app, game.app];
    expect(failuresOf(...apps)).toEqual([]);
    expect(logErrors(...apps)).toEqual([]);
  });

  it("editor.capture, the Game Shot and the Series take the png of { png }", async () => {
    stack = await startStack();
    const { tools, server, agent, game } = stack;
    const { gameView, panels } = tools.app;
    expect(DOORS.png).toBe(PNG_1X1);

    const ran = await panels.run("editor.capture");
    expect(ran.value).toMatchObject({ image: PNG_1X1, frame: expect.any(Number) });

    const shot = await gameView.capture();
    if (shot === undefined) throw new Error("the Shot was refused");
    expect(shot.image).toBe(PNG_1X1);
    expect(server.written).toContainEqual({
      path: shot.path,
      bytes: expect.any(Number),
      kind: "capture"
    });

    const series = await gameView.series({ durationMs: 300, intervalMs: 100 });
    if (series === undefined) throw new Error("the Series was refused");
    expect(series.shots).toBeGreaterThan(0);

    const apps = [server.app, agent.app, tools.app, game.app];
    expect(failuresOf(...apps)).toEqual([]);
    expect(logErrors(...apps)).toEqual([]);
  });
});
