// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"disableIframePageLoading":true}}
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { readFileSync } from "node:fs";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsCore, createToolsPlugin, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { ElementRef, SceneSnapshot } from "../../../panels/shared/scene";
import type { Json, Manifest, RunResult, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import { errorCode, wireError } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import type { RanEvent } from "../../../workspace/types";
import { gameViewPlugin } from "../..";
import type { SeriesIndex } from "../../types";
import { createFilesStore, type FilesStore } from "../files-store";
import { PNG, sceneCapture } from "../helpers";
import { createTestHub, paramsOf, type TestHub } from "./test-hub";

// ─────────────────────────────────────────────────────────────────────────────
// A tools core with the real link, workspace, panels and gameView over an
// in-process hub: the game side is scripted from the merge-game scene captures
// of panels (board/awaitIntent on the inert renderer) and stub editor.capture /
// editor.series / editor.seriesStop commands; the files side is in memory.
// ─────────────────────────────────────────────────────────────────────────────

const BOARD = sceneCapture("scene-board.txt");
const SCENE_IDS = ["game.ui", "game.entities", "game.projections"];
const ITEM: ElementRef = { kind: "entity", id: 1_048_628 };

const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:3000/__editor/ws",
  token: "tok-1",
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/work/game",
  gameUrl: "/game.html"
};

const SESSION: SessionInfo = {
  id: "s-1",
  game: "merge-game 0.0.0",
  page: BOOT.gameUrl,
  embedded: true,
  connectedAt: 1000
};

const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/game.html",
  embedded: true,
  sources: ["game.position", "game.ui", "game.entities", "game.projections", "game.rect"].map(
    id => ({
      id,
      title: id,
      input: {},
      changes: "frame" as const
    })
  ),
  commands: ["editor.capture", "editor.series", "editor.seriesStop", "editor.overlay"].map(id => ({
    id,
    title: id,
    input: {},
    effect: "read" as const
  }))
};

const VALUES: ReadonlyMap<string, Json> = new Map<string, Json>([
  ["game.ui", BOARD.ui],
  ["game.entities", BOARD.entities],
  ["game.projections", BOARD.projections],
  [
    "game.position",
    { path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: ["merge"] }
  ]
]);

/** The stage of a run result. */
const STATE = { path: "board/awaitIntent", frame: 1841, tainted: false };

/** Does nothing (the unwatch of a scripted watch). */
function noop(): void {}

/**
 * The scripted game side.
 *
 * @returns The backend.
 */
function scriptedGame() {
  return {
    read(id: string, input?: Json): Promise<Json> {
      if (id === "game.rect") {
        const key =
          typeof input === "object" && input !== null && !Array.isArray(input)
            ? input.key
            : undefined;
        return Promise.resolve(typeof key === "string" ? (BOARD.rects[key] ?? null) : null);
      }
      const value = VALUES.get(id);
      return value === undefined
        ? Promise.reject(wireError(errorCode.unknownMethod, `[moku-editor] Unknown source ${id}.`))
        : Promise.resolve(value);
    },
    watch(id: string, _input: Json | undefined, onValue: (value: Json) => void): () => void {
      queueMicrotask(() => onValue(VALUES.get(id) ?? null));
      return noop;
    },
    run(id: string): Promise<RunResult> {
      const device = { w: 393, h: 852, orientation: "portrait" };
      if (id === "editor.capture")
        return Promise.resolve({ value: { image: PNG, frame: 1841, device }, state: STATE });
      if (id === "editor.series") {
        const shots = [0, 1, 2, 3].map(index => ({
          image: PNG,
          frame: 1777 + index * 3,
          atMs: index * 50
        }));
        return Promise.resolve({ value: { shots, device }, state: STATE });
      }
      return Promise.resolve({ value: { stopped: true }, state: STATE });
    }
  };
}

/** What the stop probe saw while gameView had stopped and workspace had not. */
const probe = { overlayAfterKey: true, frameLayer: false };

/** Stops after gameView (registered before it): checks what gameView left behind. */
const stopProbe = createToolsPlugin("stopProbe", {
  onStop: () => {
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "i" }));
    probe.overlayAfterKey = document.querySelector("[data-game='overlay']") !== null;
    probe.frameLayer = document.querySelector("[data-frame-layer]") !== null;
  }
});

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, stopProbe, gameViewPlugin]
});

let hub: TestHub;
let files: FilesStore;
let ran: RanEvent[];
let root: HTMLElement;

/**
 * The tools app with a driver plugin that emits the global intents and records workspace:ran.
 *
 * @returns The app.
 */
function createApp() {
  const driver = framework.createPlugin("driver", {
    api: ctx => ({
      openSheet: (index: string) => ctx.emit("workspace:open-sheet", { index }),
      inspect: (ref: ElementRef) => ctx.emit("workspace:inspect", { ref }),
      typeChecks: () => {
        ctx.emit("workspace:reveal", { ref: ITEM });
        // @ts-expect-error — the ref is an ElementRef, not a string
        ctx.emit("workspace:reveal", { ref: "boardScreen" });
        // @ts-expect-error — gameView declares no events
        ctx.emit("gameView:reveal", { ref: ITEM });
      }
    }),
    hooks: () => ({
      "workspace:ran": (payload: RanEvent) => {
        ran.push(payload);
      }
    })
  });
  const app = framework.createApp({ plugins: [driver] });
  app.log.clearSinks();
  return app;
}

/**
 * Waits until the check passes (real time; the hub answers on microtasks).
 *
 * @param check - The condition.
 * @param label - What is awaited.
 */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
}

/**
 * Starts the app, mounts the shell, opens the session and shows Game until the scene is built.
 *
 * @returns The app and the scene.
 */
async function startInGame() {
  const app = createApp();
  await app.start();
  act(() => app.workspace.mount(root));
  hub.open(SESSION, MANIFEST);
  await until(() => app.link.session() === SESSION.id, "session");
  hub.heartbeat(1841);
  await until(() => app.link.status().kind === "live", "live");
  act(() => app.workspace.show("game"));
  await until(
    () => document.querySelector("[data-game='stage'] [data-part='slot']") !== null,
    "stage"
  );
  let scene: SceneSnapshot | undefined;
  await until(() => {
    app.gameView.scene().then(built => {
      scene = built;
    }, noop);
    return scene?.calibrated === true && scene.nodes.has("ui:boardScreen/boardSlot");
  }, "scene");
  if (scene === undefined) throw new Error("no scene");
  return { app, scene };
}

/**
 * The scene subs the hub saw unwatched.
 *
 * @returns Their source ids.
 */
function sceneUnwatches(): string[] {
  return hub
    .requests("unwatch", "game")
    .map(request => hub.subs.get(Number(paramsOf(request).sub)) ?? "")
    .filter(id => SCENE_IDS.includes(id));
}

beforeEach(() => {
  files = createFilesStore();
  hub = createTestHub(scriptedGame(), files);
  vi.stubGlobal("WebSocket", hub.Socket);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1080,
    bottom: 1440,
    width: 1080,
    height: 1440,
    toJSON: () => ({})
  });
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
  ran = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("gameView integration", () => {
  it("types the app surface, the hooks and the emits", () => {
    const app = createApp();
    expectTypeOf(app.gameView.scene).returns.resolves.toEqualTypeOf<SceneSnapshot>();
    expectTypeOf(app.gameView.selected).returns.toEqualTypeOf<ElementRef | undefined>();
    expectTypeOf<ToolsEvents["workspace:inspect"]>().toEqualTypeOf<{ ref: ElementRef }>();
    expectTypeOf(app.driver.typeChecks).toBeFunction();
    const narrow = (ref: ElementRef): string | number => {
      if (ref.kind === "entity") {
        expectTypeOf(ref.id).toBeNumber();
        return ref.id;
      }
      expectTypeOf(ref.path).toBeString();
      return ref.path;
    };
    expect(narrow(ITEM)).toBe(1_048_628);
    const source = readFileSync(`${process.cwd()}/src/plugins/gameView/index.ts`, "utf8");
    expect(source).toMatch(/createToolsPlugin\("gameView", \{/);
    expect(source).not.toMatch(/createToolsPlugin</);
  });

  it("show Game: the scene watches deliver and scene() lists boardSlot and the board items", async () => {
    const iframe = document.querySelector("iframe[data-game-frame]");
    const { app, scene } = await startInGame();

    expect(hub.requests("watch", "game").map(request => paramsOf(request).id)).toEqual(
      expect.arrayContaining(["game.position", ...SCENE_IDS])
    );
    expect(scene.nodes.get("ui:boardScreen/boardSlot")?.rect).toEqual({
      x: 55,
      y: 801,
      w: 970,
      h: 970
    });
    expect(scene.nodes.get("entity:1048628")?.rect).toEqual({ x: 428.5, y: 880.5, w: 223, h: 223 });
    expect(app.workspace.gameFrame().box()?.docked).toBe("stage");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    if (iframe !== null) expect(document.querySelector("iframe")).toBe(iframe);
    await app.stop();
  });

  it("the picker selects the board item under the pointer", async () => {
    const { app } = await startInGame();
    act(() => app.gameView.pick(true));
    await until(() => document.querySelector("[data-part='picker']") !== null, "picker layer");
    const box = app.workspace.gameFrame().box();
    if (box === undefined) throw new Error("no frame box");
    const layer = document.querySelector("[data-part='picker']");
    act(() => {
      layer?.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: box.left + 540 * box.scale,
          clientY: box.top + 990 * box.scale,
          bubbles: true
        })
      );
    });
    // The click reads the scene once more through the hub before it picks.
    await until(() => app.gameView.selected() !== undefined, "the picked element");
    expect(app.gameView.selected()).toEqual(ITEM);
    await app.stop();
  });

  it("capture() writes the PNG through panels.run, shows the card, and workspace:ran says panel", async () => {
    const { app } = await startInGame();
    const shot = await app.gameView.capture();

    expect(shot?.path).toMatch(/^\.moku\/captures\/\d{4}-\d{2}-\d{2}\/\d{4}-board\.png$/);
    expect(files.dataUrl(shot?.path ?? "")).toBe(PNG);
    expect(hub.requests("run", "game").map(request => paramsOf(request).id)).toEqual([
      "editor.capture"
    ]);
    await until(() => document.querySelector("[data-game='card']") !== null, "capture card");
    await until(() => ran.length > 0, "workspace:ran");
    expect(ran[0]).toMatchObject({ id: "editor.capture", origin: "panel", ok: true });
    await app.stop();
  });

  it("series() makes one editor.series call and writes 001.png…004.png and index.json", async () => {
    const { app } = await startInGame();
    const result = await app.gameView.series({ durationMs: 200, intervalMs: 50 });

    const runs = hub
      .requests("run", "game")
      .filter(request => paramsOf(request).id === "editor.series");
    expect(runs.map(request => paramsOf(request).input)).toEqual([
      { durationMs: 200, intervalMs: 50 }
    ]);
    const folder = result?.folder ?? "?";
    expect(folder).toMatch(/^\.moku\/captures\/\d{4}-\d{2}-\d{2}\/series-\d{4}\/$/);
    for (const name of ["001.png", "002.png", "003.png", "004.png"]) {
      expect(files.dataUrl(`${folder}${name}`)).toBe(PNG);
    }
    const index: SeriesIndex = JSON.parse(files.text(`${folder}index.json`));
    expect(index).toEqual({
      label: "board/awaitIntent",
      durationMs: 200,
      intervalMs: 50,
      fromFrame: 1777,
      shots: [
        { file: "001.png", frame: 1777, atMs: 0, bug: false },
        { file: "002.png", frame: 1780, atMs: 50, bug: false },
        { file: "003.png", frame: 1783, atMs: 100, bug: false },
        { file: "004.png", frame: 1786, atMs: 150, bug: false }
      ],
      device: { name: app.workspace.device().preset.name, w: 393, h: 852, orientation: "portrait" }
    });
    await until(() => document.querySelector("dialog[data-game='sheet']") !== null, "sheet");
    await app.stop();
  });

  it("workspace:open-sheet opens a saved series; workspace:inspect shows Game and selects", async () => {
    const folder = ".moku/captures/series-2026-09-24-1015/";
    files.put(
      `${folder}index.json`,
      JSON.stringify({
        label: "merge",
        durationMs: 100,
        intervalMs: 50,
        fromFrame: 1,
        shots: [
          { file: "001.png", frame: 1, atMs: 0, bug: false },
          { file: "002.png", frame: 4, atMs: 50, bug: true }
        ]
      })
    );
    await files.writeBinary(`${folder}001.png`, PNG);
    const { app } = await startInGame();

    act(() => {
      app.driver.openSheet(`${folder}index.json`);
    });
    await until(
      () => document.querySelectorAll("dialog[data-game='sheet'] [data-part='tile']").length === 2,
      "sheet"
    );
    expect(document.querySelector("[data-part='bugs']")?.textContent).toBe("1 marked as bug");

    act(() => app.workspace.show("flow"));
    act(() => {
      app.driver.inspect(ITEM);
    });
    expect(app.workspace.active()).toBe("game");
    expect(app.gameView.selected()).toEqual(ITEM);
    await app.stop();
  });

  it("Reference mode: proxies in the frame overlay in any workspace; off removes them", async () => {
    const { app } = await startInGame();
    act(() => app.workspace.setReference(true));
    await until(
      () => document.querySelector("[data-moku-proxy][data-moku-key='boardSlot']") !== null,
      "proxies"
    );
    const slot = document.querySelector<HTMLElement>("[data-moku-key='boardSlot']");
    expect(slot?.dataset.mokuBounds).toBe("55 801 970 970");
    expect(slot?.closest("[data-frame-overlay]")).not.toBeNull();
    await until(
      () => slot?.dataset.mokuNode === "board/awaitIntent",
      "the flow node of the proxies"
    );

    act(() => app.workspace.show("flow"));
    await until(() => app.workspace.active() === "flow", "flow");
    expect(sceneUnwatches()).toEqual([]);
    expect(document.querySelector("[data-moku-key='boardSlot']")).not.toBeNull();

    act(() => app.workspace.setReference(false));
    await until(() => sceneUnwatches().length === 3, "three unwatch");
    expect(document.querySelector("[data-moku-proxies]")).toBeNull();
    await app.stop();
  });

  it("leaving Game unwatches the three scene sources; stop removes the overlay root and the keys", async () => {
    const { app } = await startInGame();
    act(() => app.gameView.highlight(ITEM));
    expect(document.querySelector("[data-game='overlay'] [data-box='tree']")).not.toBeNull();

    act(() => app.workspace.show("flow"));
    await until(() => sceneUnwatches().length === 3, "three unwatch");
    expect(sceneUnwatches().toSorted()).toEqual([...SCENE_IDS].toSorted());

    probe.overlayAfterKey = true;
    probe.frameLayer = false;
    await app.stop();
    expect(probe.frameLayer).toBe(true);
    expect(probe.overlayAfterKey).toBe(false);
  });
});
