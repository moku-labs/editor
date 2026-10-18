// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"navigation":{"disableChildFrameNavigation":true}}}
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { activeSourcePlugin } from "../../../activeSource";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type {
  EditorChannel,
  Json,
  Manifest,
  SessionInfo,
  ToolsBoot
} from "../../../registry/protocol";
import { encode, notification, toWireValue } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { renderViewPlugin } from "../..";
import {
  DEMO_ASSETS,
  DEMO_EFFECTS,
  DEMO_FILES,
  DEMO_RENDER,
  DEMO_SESSION,
  DEMO_TIME_ORIGIN,
  demoDetail,
  demoDirectory,
  demoEvents,
  demoFrames,
  demoManifest,
  demoPasses,
  demoSecond,
  demoSession,
  demoTelemetry,
  secondOf
} from "../device-fixtures";
import { rowsOf, wireOf } from "../mission-fixtures";
import { type AgentHub, createAgentHub } from "./agent-hub";

// ─────────────────────────────────────────────────────────────────────────────
// Mission control end to end (spec 09 § M16 Integration): the tools core with
// the real link, activeSource, workspace, panels and renderView over an
// in-process hub with two agents — this page's local preview and the design's
// demo Galaxy A26 by wire (device-fixtures.ts). The local preview fills the
// history first; the phone links and becomes the source (activeSource's
// autoUse): every old watch and the poll stop, the history holds only the
// phone's frames, the bar names it, no scene source is watched, the Device load
// card reads its telemetry; a range selection reads the engine's detail once;
// the rate switch and Record reach the phone; losing the phone returns to the
// local preview with activeSource's marker and no banner inside Render; stop
// leaves no watch and no poll.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, activeSourcePlugin, workspacePlugin, panelsPlugin, renderViewPlugin]
});

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

/** The Mission control feeds of an agent with perf and the recorder. */
const FEEDS = [
  "editor.perf.second",
  "editor.perf.frames",
  "editor.perf.events",
  "editor.perf.passes",
  "editor.perf.detail",
  "editor.recorder"
];

/** The scene sources of the local preview. */
const SCENE = [
  "game.render",
  "game.assets",
  "game.effects",
  "game.ui",
  "game.entities",
  "game.projections"
];

/** The local preview's manifest. */
const LOCAL_MANIFEST: Manifest = {
  game: "A Memory Missing 0.4.2",
  page: "http://127.0.0.1:3000/game.html",
  embedded: true,
  sources: [...FEEDS, ...SCENE].map(id => ({
    id,
    title: id,
    input: {},
    changes: "frame" as const
  })),
  commands: []
};

/** The newest frame of the phone. */
const LAST = 4960;

let hub: AgentHub;
let root: HTMLElement;

/**
 * Waits for a condition, letting the hub and the timers run.
 *
 * @param check - The condition.
 * @param label - What is waited for.
 */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
}

/**
 * The `after` of a read's input.
 *
 * @param input - The input.
 * @returns The number; undefined without one.
 */
function afterOf(input: Json | undefined): number | undefined {
  const after =
    typeof input === "object" && input !== null && !Array.isArray(input) ? input.after : undefined;
  return typeof after === "number" ? after : undefined;
}

/**
 * An agent channel answering reads from a table and watches with one value each.
 *
 * @param reads - The read answers by id.
 * @param values - The watched values by id.
 * @returns The channel.
 */
function channelOf(
  reads: Readonly<Record<string, (input: Json | undefined) => Json>>,
  values: Readonly<Record<string, Json>>
): EditorChannel {
  return {
    read: (id, input) => Promise.resolve(reads[id]?.(input) ?? values[id] ?? null),
    watch: (id, _input, onValue) => {
      const value = values[id];
      if (value !== undefined) queueMicrotask(() => onValue(value));
      return () => undefined;
    },
    run: () => Promise.reject(new Error("[moku-editor] no commands here")),
    status: () => ({ kind: "live", frame: 1 })
  };
}

/** The local preview's agent: 200 frames at 120 fps from f12001, a trusted 20 MB heap. */
function localChannel(): EditorChannel {
  return channelOf(
    {
      "editor.perf.frames": () =>
        toWireValue(
          wireOf(
            rowsOf(12_001, 200, { stepMs: 8.33, each: () => ({ budgetMs: 8.33, rateMs: 8.33 }) })
          )
        ),
      "editor.perf.events": () =>
        toWireValue({
          v: 1,
          epoch: "1792000000000.5",
          timeOrigin: DEMO_TIME_ORIGIN,
          next: 1,
          lost: false,
          items: []
        })
    },
    {
      "editor.perf.second": toWireValue(
        secondOf({
          rate: { fps: 120, mode: "auto", reason: "start", displayHz: 120, switches: 0 },
          memory: {
            heapMb: 20,
            source: "performance.memory",
            trusted: true,
            why: null,
            processMb: null
          },
          epoch: "1792000000000.5"
        })
      ),
      "game.render": DEMO_RENDER,
      "game.assets": DEMO_ASSETS
    }
  );
}

/** The demo phone's agent. */
function phoneChannel(): EditorChannel {
  return channelOf(
    {
      "editor.perf.frames": input => toWireValue(demoFrames(afterOf(input), LAST)),
      "editor.perf.events": input => toWireValue(demoEvents(afterOf(input), LAST)),
      "editor.perf.detail": input => {
        const range =
          typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
        return toWireValue(demoDetail(Number(range.from), Number(range.to)));
      }
    },
    {
      "editor.perf.second": toWireValue(demoSecond(LAST)),
      "editor.perf.passes": toWireValue(demoPasses(LAST)),
      "game.render": DEMO_RENDER,
      "game.assets": DEMO_ASSETS,
      "game.effects": DEMO_EFFECTS
    }
  );
}

/**
 * Delivers a notification to every socket link opened.
 *
 * @param channel - "editor" or "game".
 * @param method - The method.
 * @param params - Its params.
 * @param session - The session it is about.
 */
function deliver(channel: "editor" | "game", method: string, params: Json, session?: string): void {
  for (const socket of hub.sockets)
    socket.deliver(encode(notification(channel, method, params, session)));
}

/**
 * The reads link sent, of one source id and session.
 *
 * @param id - The source id.
 * @param session - The session.
 * @returns How many.
 */
function readsOf(id: string, session: string): number {
  return hub.received.filter(
    request =>
      request.method === "read" &&
      request.session === session &&
      typeof request.params === "object" &&
      request.params !== null &&
      !Array.isArray(request.params) &&
      request.params.id === id
  ).length;
}

/**
 * The open agent watches of a session.
 *
 * @param session - The session.
 * @returns Their source ids, sorted.
 */
function watchesOf(session: string): string[] {
  return [...hub.agentWatches.values()]
    .filter(entry => entry.session === session)
    .map(entry => entry.id)
    .toSorted();
}

/**
 * The text of the Render workspace.
 *
 * @param selector - Inside it.
 * @returns The text.
 */
function text(selector: string): string {
  return root.querySelector(selector)?.textContent ?? "";
}

beforeEach(() => {
  const finds = new Map<string, Json>(
    Object.entries(DEMO_FILES).map(([system, file]) => [
      `system:${system}`,
      [{ path: file.path, line: file.line, range: [file.line, 1, file.line, 20], hash: "h1" }]
    ])
  );
  hub = createAgentHub({
    channel: localChannel(),
    channels: new Map([[DEMO_SESSION, phoneChannel()]]),
    files: new Map(),
    finds
  });
  vi.stubGlobal("WebSocket", hub.Socket);
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Mission control", () => {
  it("local preview → the Galaxy A26 by wire → range, rate, record → lost → stop", {
    timeout: 20_000
  }, async () => {
    const app = framework.createApp();
    app.log.clearSinks();
    await app.start();
    act(() => app.workspace.mount(root));
    const local: SessionInfo = {
      id: "s-1",
      game: "A Memory Missing 0.4.2",
      page: app.link.frameUrl("http://127.0.0.1:3000/game.html"),
      embedded: true,
      connectedAt: 1000
    };
    hub.open(local, { ...LOCAL_MANIFEST, page: local.page });
    hub.heartbeat("s-1", 12_200, false);
    act(() => app.workspace.show("render"));

    // The local preview is the source; the poll fills the history.
    await until(() => app.renderView.mission()?.source.name === "Local preview", "local source");
    await until(() => (app.renderView.mission()?.stats.frames ?? 0) > 0, "local frames");
    expect(text("[data-source-name]")).toBe("Local preview");
    expect(watchesOf("s-1")).toContain("editor.perf.second");

    // The phone links by wire: activeSource makes it the source (autoUse, reason connected).
    deliver("editor", "devices", toWireValue(demoDirectory()));
    hub.answers.set("game.pause", () => ({ value: true }));
    hub.open(demoSession(), demoManifest());
    deliver("game", "heartbeat", { frame: LAST, paused: false, at: Date.now() }, DEMO_SESSION);
    await until(
      () => app.renderView.mission()?.source.name === "Galaxy A26",
      "the phone as source"
    );
    await until(() => (app.renderView.mission()?.stats.frames ?? 0) > 0, "the phone's frames");
    const localReads = readsOf("editor.perf.frames", "s-1");

    expect(watchesOf("s-1").filter(id => id.startsWith("editor."))).toEqual([]);
    expect(app.renderView.select({ from: 12_050, to: 12_050 })).toBeUndefined();
    expect(text("[data-source-name]")).toBe("Galaxy A26");
    expect(text("[data-health]")).toContain("by wire, USB");
    expect(text("[data-paused-chip]")).toContain("Local preview paused");
    expect(
      watchesOf(DEMO_SESSION).filter(id => /game\.(ui|entities|projections)/u.test(id))
    ).toEqual([]);

    deliver("editor", "deviceTelemetry", toWireValue(demoTelemetry(DEMO_TIME_ORIGIN + 14_000)));
    await until(() => text("[data-card-kind='load']").includes("% app"), "the Device load card");
    expect(text("[data-card-kind='load']")).toContain("27");
    expect(root.querySelector("[data-card-kind='load'] [data-off]")).toBeNull();
    expect(text("[data-card-kind='memory'] [data-part='source-line']")).toBe(
      "JS heap via DevTools over USB"
    );

    // A range: one detail read, and the inspector lists what ran in it.
    expect(app.renderView.select({ from: 4810, to: 4860 })).toEqual({ from: 4810, to: 4860 });
    await until(() => readsOf("editor.perf.detail", DEMO_SESSION) === 1, "the detail read");
    await until(() => {
      const view = app.renderView.inspect();
      return view?.kind === "range" && view.detail === "full" && view.files.length > 0;
    }, "the full range");
    const range = app.renderView.inspect();
    if (range?.kind !== "range") throw new Error("no range view");
    expect(range.systems.map(system => system.name)).toContain("ward.update");
    expect(range.nodes.map(node => `${node.label} ${node.how}`)).toContain("fogLayer redrawn");
    expect(range.files).toContainEqual({
      path: "src/features/ward/rules.ts",
      line: 142,
      system: "ward.update"
    });
    expect(range.spikes.map(spike => [spike.from, spike.to, spike.cause])).toEqual([
      [4851, 4853, "gpu"]
    ]);
    expect(range.gcs.map(gc => gc.frame)).toEqual([4818]);
    expect(range.passes.length).toBeGreaterThan(0);
    expect(range.filters.length).toBeGreaterThan(0);
    expect(range.compiles).toEqual([]);
    expect(range.rates.map(rate => [rate.frame, rate.from, rate.to])).toEqual([[4855, 120, 60]]);
    const links = [...root.querySelectorAll("[data-render='inspector'] [data-file-link]")];
    expect(links.map(link => link.getAttribute("title"))).toContain(
      "Open src/features/ward/rules.ts:142 in your editor"
    );
    expect(readsOf("editor.perf.detail", DEMO_SESSION)).toBe(1);

    // The rate switch and Record reach the phone.
    hub.answers.set("game.frameRate", () => ({
      value: { fps: 120, mode: "fixed", reason: "forced", displayHz: 120, asked: 120, heldBy: null }
    }));
    let rate: Awaited<ReturnType<typeof app.renderView.setRate>> | undefined;
    await act(async () => {
      rate = await app.renderView.setRate(120);
    });
    expect(rate).toMatchObject({ ok: true, text: "Pinned at 120, adaptive off" });
    const ranRate = hub.runs("game.frameRate").at(-1);
    expect(ranRate?.session).toBe(DEMO_SESSION);
    expect(ranRate?.params).toMatchObject({ input: { fps: 120 } });
    await until(
      () => text("[data-rate-answer='ok']").includes("Pinned at 120, adaptive off"),
      "the answer line"
    );

    hub.answers.set("editor.record", () => ({
      value: {
        on: true,
        file: "perf-1.jsonl",
        startedBy: { by: "editor", name: null },
        marked: false
      }
    }));
    await act(async () => {
      await app.renderView.record(true);
    });
    expect(hub.runs("editor.record").at(-1)?.params).toMatchObject({ input: { on: true } });
    expect(JSON.stringify(hub.runs("editor.record").at(-1)?.params)).not.toContain('"by"');

    // The phone is lost: the local preview again, activeSource's marker, no banner inside Render.
    hub.close(DEMO_SESSION, "bye");
    await until(() => app.renderView.mission()?.source.kind === "local", "the local preview again");
    expect(app.activeSource.markers().at(-1)?.label).toContain("Galaxy A26 disconnected here");
    expect(text("[data-render='workspace']")).not.toContain("disconnected");
    await until(
      () => watchesOf("s-1").includes("editor.perf.second"),
      "the local preview watched again"
    );
    expect(readsOf("editor.perf.frames", "s-1")).toBeGreaterThanOrEqual(localReads);

    // Stop: no watch and no poll left.
    await app.stop();
    expect([...hub.agentWatches.values()]).toEqual([]);
    const reads = hub.received.length;
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect(hub.received.length).toBe(reads);
  });
});
