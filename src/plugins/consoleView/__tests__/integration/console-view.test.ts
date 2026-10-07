// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createToolsCore, type ToolsEvents, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { Json, Manifest, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import {
  type AgentHub,
  createAgentHub,
  createScriptedChannel,
  type ScriptedChannel
} from "../../../renderView/__tests__/integration/agent-hub";
import { workspacePlugin } from "../../../workspace";
import type { RanEvent } from "../../../workspace/types";
import { consoleViewPlugin } from "../..";
import type { LevelCounts, LogLine } from "../../types";
import { TRACE, traceValue } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The tools core with the real link, workspace, panels and consoleView over an
// in-process hub to a scripted agent channel serving game.log, plus a probe
// plugin (no depends) that emits workspace:ran and hooks workspace:focus-frame.
// No flowView.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, consoleViewPlugin]
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
  sources: [{ id: "game.log", title: "game.log", input: {}, changes: "frame" }],
  commands: []
};

const STEP_ERROR: RanEvent = {
  id: "game.step",
  input: { frames: "x" },
  origin: "topbar",
  at: 5000,
  ok: false,
  error: {
    code: -32_602,
    message: "[moku-editor] game.step: frames must be a number",
    data: { reason: "invalid_input", field: "frames" }
  }
};

let hub: AgentHub;
let agent: ScriptedChannel;
let root: HTMLElement;
let focused: number[];

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
}

function watched(): string[] {
  return [...hub.agentWatches.values()].map(entry => entry.id);
}

function badge(): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-workspace='console'] [data-badge]");
}

function texts(lines: readonly LogLine[]): string[] {
  return lines.map(line => (line.kind === "meta" ? line.text : `${line.source} ${line.message}`));
}

function createApp() {
  const probe = framework.createPlugin("probe", {
    api: ctx => ({
      ran: (event: RanEvent) => {
        ctx.emit("workspace:ran", event);
      }
    }),
    hooks: () => ({
      "workspace:focus-frame": (payload: ToolsEvents["workspace:focus-frame"]) => {
        focused.push(payload.frame);
      }
    })
  });
  const app = framework.createApp({ plugins: [probe] });
  app.log.clearSinks();
  return app;
}

beforeEach(() => {
  agent = createScriptedChannel({ "game.log": traceValue() }, {});
  hub = createAgentHub({ channel: agent.channel, files: new Map() });
  vi.stubGlobal("WebSocket", hub.Socket);
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
  focused = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("consoleView integration", () => {
  it("types the app surface", () => {
    const app = createApp();
    expectTypeOf(app.consoleView.counts).returns.toEqualTypeOf<LevelCounts>();
    expectTypeOf(app.consoleView.focusFrame).parameter(0).toBeNumber();
    expectTypeOf<ToolsEvents["workspace:focus-frame"]>().toEqualTypeOf<{ frame: number }>();
    // @ts-expect-error — debug is not a level filter
    app.consoleView.setFilter({ level: "debug" });
    expect(app.panels.list().map(panel => panel.id)).toEqual(["console"]);
  });

  it("createApp → start → watched log → badge → command error → focus frame → reload → stop", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));

    // One game.log watch for the session, sent once a session is attached.
    hub.open(SESSION, MANIFEST);
    hub.heartbeat(SESSION.id, 58, false);
    await until(() => watched().length === 1, "game.log watch");
    expect(watched()).toEqual(["game.log"]);

    // The watch delivers the design §8 log: 8 lines, 2 warnings.
    await until(() => app.consoleView.lines().length === 8, "trace");
    expect(app.consoleView.counts()).toEqual({ all: 8, debug: 0, info: 6, warn: 2, error: 0 });
    await until(() => badge() !== null, "badge");
    expect(badge()?.textContent).toBe("2");
    expect(badge()?.dataset.tone).toBe("warn");

    app.consoleView.setFilter({ level: "warn" });
    expect(app.consoleView.visible()).toHaveLength(2);
    app.consoleView.setFilter({ level: "all" });

    // A failed top-bar step is "Logged in Console" (D1), prefix stripped.
    act(() => app.probe.ran(STEP_ERROR));
    expect(texts(app.consoleView.lines()).at(-1)).toBe(
      "editor -32602 game.step: frames must be a number"
    );
    await until(() => badge()?.textContent === "3", "badge 3");
    expect(badge()?.dataset.tone).toBe("error");

    // A frame link focuses Flow through the global event; the probe hooks it.
    app.consoleView.focusFrame(1778);
    expect(focused).toEqual([1778]);

    // A new line the game logs arrives through the watch.
    agent.set(
      "game.log",
      traceValue([...TRACE, { level: "error", event: "flow: boom", ts: 1080 }])
    );
    await until(() => app.consoleView.counts().error === 2, "new line");

    // The game page reloads: a new session, a fresh trace through the re-sent watch.
    agent.set(
      "game.log",
      traceValue([{ level: "info", event: "flow: enter main/boot", ts: 9000 }])
    );
    hub.close(SESSION.id, "game_reloaded");
    hub.open({ ...SESSION, id: "s-2", connectedAt: 9000 }, MANIFEST);
    hub.heartbeat("s-2", 3, false);
    await until(() => app.consoleView.lines()[0]?.kind === "meta", "reload meta row");
    expect(texts(app.consoleView.lines())).toEqual([
      "Log cleared: the game page reloaded. Turn on Preserve log to keep it.",
      "flow enter main/boot"
    ]);
    await until(() => badge() === null, "badge cleared");

    const listener = vi.fn();
    app.consoleView.subscribe(listener);
    await app.stop();
    expect(hub.unwatched).toContain("game.log");
    expect(watched()).toEqual([]);
    const last: Json = traceValue();
    agent.set("game.log", last);
    expect(listener).not.toHaveBeenCalled();
  });
});
