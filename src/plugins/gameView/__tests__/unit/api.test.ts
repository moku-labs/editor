// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameViewApi } from "../../api";
import { createHandlers } from "../../handlers";
import { initGameView, startGameView, stopGameView } from "../../lifecycle";
import { createCtx, flush, PNG, sceneCapture, type TestCtx, useScene } from "../helpers";

const BOARD = sceneCapture("scene-board.txt");
let ctx: TestCtx;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  ctx = createCtx({
    ".moku/notes/2026-09-24-a.md": "---\ntitle: A\nstatus: idea\ncaptures: []\n---\n"
  });
  useScene(ctx);
  ctx.panels.answers.set("editor.capture", {
    image: PNG,
    frame: 1841,
    device: { w: 393, h: 852, orientation: "portrait" }
  });
});

afterEach(() => {
  stopGameView(ctx);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("createGameViewApi", () => {
  it("has the fourteen members of GameViewApi", () => {
    expect(Object.keys(createGameViewApi(ctx)).toSorted()).toEqual([
      "attach",
      "capture",
      "highlight",
      "inspect",
      "locate",
      "manifest",
      "notes",
      "openSheet",
      "pick",
      "scene",
      "select",
      "selected",
      "series",
      "stopSeries"
    ]);
  });

  it("pick, select, selected, inspect and highlight act on the state", () => {
    const api = createGameViewApi(ctx);
    api.pick(true);
    expect(ctx.state.picker.on).toBe(true);
    api.select({ kind: "entity", id: 1_048_628 });
    expect(api.selected()).toEqual({ kind: "entity", id: 1_048_628 });
    api.inspect({ kind: "ui", path: "boardScreen" });
    expect(api.selected()).toEqual({ kind: "ui", path: "boardScreen" });
    api.highlight(undefined);
    expect(ctx.state.treeHover).toBeUndefined();
  });

  it("scene, locate, manifest and notes read through the link", async () => {
    const api = createGameViewApi(ctx);
    const scene = await api.scene();
    expect(scene.nodes.get("ui:boardScreen/boardSlot")?.rect).toEqual({
      x: 55,
      y: 801,
      w: 970,
      h: 970
    });
    expect(await api.locate({ kind: "entity", id: 1_048_628 })).toEqual({
      x: 428.5,
      y: 880.5,
      w: 223,
      h: 223
    });
    expect(await api.manifest()).toBeUndefined();
    expect(await api.notes()).toEqual([{ path: ".moku/notes/2026-09-24-a.md", title: "A" }]);
  });

  it("capture runs editor.capture through panels.run, never link.run; attach writes the note", async () => {
    const api = createGameViewApi(ctx);
    const shot = await api.capture();
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.capture");
    expect(ctx.link.run).not.toHaveBeenCalled();
    await api.attach(shot?.path ?? "", ".moku/notes/2026-09-24-a.md");
    expect(ctx.link.files.text(".moku/notes/2026-09-24-a.md")).toContain(shot?.path ?? "?");
  });

  it("series, stopSeries and openSheet run through panels and files", async () => {
    ctx.panels.answers.set("editor.series", {
      shots: [{ image: PNG, frame: 1, atMs: 0 }],
      device: { w: 393, h: 852, orientation: "portrait" }
    });
    const api = createGameViewApi(ctx);
    const result = await api.series({ durationMs: 50, intervalMs: 50 });
    api.stopSeries();
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.seriesStop");
    ctx.state.series.sheet = undefined;
    await api.openSheet(result?.indexPath ?? "");
    expect(ctx.state.series.sheet).toMatchObject({ images: [PNG] });
  });
});

describe("no auto-capture", () => {
  it("init, start, hooks, watches and time never run editor.capture or editor.series", async () => {
    vi.useFakeTimers();
    initGameView(ctx);
    ctx.workspace.activeValue = "game";
    startGameView(ctx);
    const hooks = createHandlers(ctx);
    hooks["link:status"]({
      status: { kind: "lost", reason: "game_reloaded", lastFrame: 1, retryInMs: 1 }
    });
    hooks["link:status"]({ status: { kind: "live", frame: 2 }, session: "s-2" });
    hooks["workspace:changed"]({ ws: "flow" });
    hooks["workspace:changed"]({ ws: "game" });
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.entities", BOARD.entities);
    ctx.link.send("game.projections", BOARD.projections);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    vi.useRealTimers();

    const ran = ctx.panels.run.mock.calls.map(call => call[0]);
    expect(ran).not.toContain("editor.capture");
    expect(ran).not.toContain("editor.series");
  });

  it("no source file of gameView calls link.run, polls with setInterval or logs with console", () => {
    const root = `${process.cwd()}/src/plugins/gameView/`;
    const sources = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
      file => /\.tsx?$/.test(file) && !file.startsWith("__tests__")
    );
    expect(sources.length).toBeGreaterThan(20);
    for (const file of sources) {
      const text = readFileSync(`${root}${file}`, "utf8");
      expect(text, file).not.toMatch(/\blink\.run\(|require\(linkPlugin\)\.run\(/);
      expect(text, file).not.toMatch(/setInterval\(/);
      expect(text, file).not.toMatch(/console\./);
    }
  });
});
