// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"disableIframePageLoading":true}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import type {
  CommandDescriptor,
  Manifest,
  SessionInfo,
  ToolsBoot
} from "../../../registry/protocol";
import { workspacePlugin } from "../..";
import type { RanEvent, WorkspaceId } from "../../types";
import { createScriptedHub, type ScriptedHub } from "./fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// A tools core with the real link and workspace over a scripted hub:
// createApp → start → mount → keys, top bar, stale bar, D-07 reload → stop
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, { plugins: [linkPlugin, workspacePlugin] });

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

/**
 * A raw command descriptor.
 *
 * @param id - Command id.
 * @returns The descriptor.
 */
function command(id: string): CommandDescriptor {
  return { id, title: id, input: {}, effect: "raw" };
}

/**
 * A manifest of an embedded merge-game session.
 *
 * @returns The manifest.
 */
function manifestOf(): Manifest {
  return {
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/game.html",
    embedded: true,
    sources: [{ id: "game.position", title: "Position", input: {}, changes: "commit" }],
    commands: [
      command("game.step"),
      command("game.pause"),
      command("game.resume"),
      command("game.bookmark"),
      command("game.restore"),
      { id: "editor.overlay", title: "Overlay", input: { on: "boolean" }, effect: "cosmetic" }
    ]
  };
}

/**
 * One embedded session.
 *
 * @param id - Session id.
 * @returns The session.
 */
function sessionOf(id: string): SessionInfo {
  return { id, game: "merge-game 0.0.0", page: BOOT.gameUrl, embedded: true, connectedAt: 1000 };
}

let hub: ScriptedHub;
let changed: WorkspaceId[];
let ran: RanEvent[];
let root: HTMLElement;

/**
 * Waits until the check passes (real time; the scripted hub answers on microtasks).
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
 * The tools app with link, workspace and an observer of the workspace events.
 *
 * @returns The app.
 */
function createApp() {
  const observer = framework.createPlugin("observer", {
    hooks: () => ({
      "workspace:changed": (payload: { ws: WorkspaceId }) => {
        changed.push(payload.ws);
      },
      "workspace:ran": (payload: RanEvent) => {
        ran.push(payload);
      }
    })
  });
  const app = framework.createApp({ plugins: [observer] });
  app.log.clearSinks();
  return app;
}

beforeEach(() => {
  hub = createScriptedHub();
  vi.stubGlobal("WebSocket", hub.Socket);
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
  changed = [];
  ran = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("workspace integration", () => {
  it("start renders nothing; mount renders the shell and one iframe; a second mount keeps it", async () => {
    const app = createApp();
    await app.start();
    expect(root.childElementCount).toBe(0);
    expect(document.querySelector("iframe")).toBeNull();

    act(() => app.workspace.mount(root));
    expect(root.querySelector("[data-ui='shell']")).not.toBeNull();
    const frames = document.querySelectorAll<HTMLIFrameElement>("iframe[data-game-frame]");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute("src")).toBe(
      app.link.frameUrl("http://127.0.0.1:3000/game.html")
    );
    expect(frames[0]?.getAttribute("src")).toMatch(
      /^http:\/\/127\.0\.0\.1:3000\/game\.html\?__editorFrame=[\da-f]{12}$/
    );
    expect(app.workspace.gameFrame().url).toBe("http://127.0.0.1:3000/game.html");

    const other = document.createElement("div");
    document.body.append(other);
    act(() => app.workspace.mount(other));
    expect(root.childElementCount).toBe(0);
    expect(other.querySelector("[data-ui='shell']")).not.toBeNull();
    expect(document.querySelector("iframe[data-game-frame]")).toBe(frames[0]);
    await app.stop();
  });

  it("⌘2 shows Flow and emits workspace:changed; Step while paused emits workspace:ran topbar", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.open(sessionOf("s-1"), manifestOf());
    await until(() => app.link.manifest() !== undefined, "attach");

    act(() => {
      globalThis.dispatchEvent(
        new KeyboardEvent("keydown", { key: "2", code: "Digit2", metaKey: true, ctrlKey: true })
      );
    });
    expect(app.workspace.active()).toBe("flow");
    expect(changed).toEqual(["flow"]);

    hub.heartbeat("s-1", 1840, true);
    await until(() => app.link.status().kind === "paused", "paused");
    await until(
      () => root.querySelector("[data-action='step']")?.getAttribute("aria-disabled") === "false",
      "step enabled"
    );
    act(() => root.querySelector<HTMLButtonElement>("[data-action='step']")?.click());
    await until(() => ran.length === 1, "workspace:ran");
    expect(ran[0]).toMatchObject({ id: "game.step", origin: "topbar", ok: true });
    expect(hub.runs("game.step")).toHaveLength(1);
    await until(
      () =>
        root.querySelector("[data-ui='step-popover']")?.textContent?.includes("ok · game.step") ??
        false,
      "D1"
    );
    await app.stop();
  });

  it("a lost link after live shows the F3 stale bar", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.open(sessionOf("s-1"), manifestOf());
    await until(() => app.link.manifest() !== undefined, "attach");
    hub.heartbeat("s-1", 1840, false);
    await until(() => app.link.status().kind === "live", "live");

    hub.close("s-1", "game_reloaded");
    await until(() => app.link.status().kind === "lost", "lost");
    await until(
      () => root.querySelector("[data-ui='stale-bar'][data-tone='error']") !== null,
      "F3"
    );
    expect(root.querySelector("[data-ui='stale-bar']")?.textContent).toContain(
      "Stale · data from frame 1840 · game page reloaded"
    );
    await app.stop();
  });

  it("reload({ restore: true }): bookmark → new session → restore → toast; overlay re-applied", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.answers.set("game.bookmark", () => ({ value: { checkpoint: "home" } }));
    hub.open(sessionOf("s-1"), manifestOf());
    await until(() => app.link.manifest() !== undefined, "attach");
    hub.heartbeat("s-1", 1840, false);
    await until(() => app.link.status().kind === "live", "live");
    await app.workspace.setOverlayInGame(true);
    expect(hub.runs("editor.overlay")).toHaveLength(1);

    const iframe = document.querySelector("iframe[data-game-frame]");
    const pending = app.workspace.gameFrame().reload({ restore: true });
    await until(() => hub.runs("game.bookmark").length === 1, "bookmark");

    hub.close("s-1", "game_reloaded");
    hub.open(sessionOf("s-2"), manifestOf());
    await expect(pending).resolves.toEqual({ restored: true });

    expect(paramsOfLast("game.restore")).toEqual({ bookmark: { checkpoint: "home" } });
    await until(() => hub.runs("editor.overlay").length === 2, "overlay re-applied");
    expect(app.link.session()).toBe("s-2");
    expect(document.querySelector("iframe[data-game-frame]")).toBe(iframe);
    await until(
      () =>
        root
          .querySelector("[data-ui='toasts']")
          ?.textContent?.includes("Game reloaded · state restored from the last checkpoint") ??
        false,
      "toast"
    );
    expect(ran.map(event => event.id)).toEqual(["editor.overlay"]);
    await app.stop();
  });

  it("reload({ restore: true }) while paused: the restored game is paused again", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.answers.set("game.bookmark", () => ({ value: { checkpoint: "home" } }));
    hub.open(sessionOf("s-1"), manifestOf());
    await until(() => app.link.manifest() !== undefined, "attach");
    hub.heartbeat("s-1", 1840, true);
    await until(() => app.link.status().kind === "paused", "paused");

    const pending = app.workspace.gameFrame().reload({ restore: true });
    await until(() => hub.runs("game.bookmark").length === 1, "bookmark");
    hub.close("s-1", "game_reloaded");
    hub.open(sessionOf("s-2"), manifestOf());
    await expect(pending).resolves.toEqual({ restored: true });

    expect(hub.runs("game.pause").map(request => request.session)).toEqual(["s-2"]);
    expect(ran).toEqual([]);
    await app.stop();
  });

  it("a second tools tab's game takes neither the session nor the reload of this tab", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    const page = app.link.frameUrl("http://127.0.0.1:3000/game.html");
    const otherPage = "http://127.0.0.1:3000/game.html?__editorFrame=000000000000";
    hub.open({ ...sessionOf("s-1"), page }, { ...manifestOf(), page });
    await until(() => app.link.manifest() !== undefined, "attach");
    hub.heartbeat("s-1", 1840, false);
    await until(() => app.link.status().kind === "live", "live");

    hub.open(
      { ...sessionOf("s-other"), page: otherPage, connectedAt: 5000 },
      { ...manifestOf(), page: otherPage }
    );
    await until(() => app.link.sessions().length === 2, "second session");
    expect(app.link.session()).toBe("s-1");

    const pending = app.workspace.gameFrame().reload();
    hub.close("s-1", "game_reloaded");
    await until(() => app.link.status().kind === "lost", "lost");
    expect(app.link.session()).toBeUndefined();

    hub.open({ ...sessionOf("s-2"), page, connectedAt: 9000 }, { ...manifestOf(), page });
    await expect(pending).resolves.toEqual({ restored: false });
    expect(app.link.session()).toBe("s-2");
    await app.stop();
  });

  it("stop() removes the shell, the iframe and every listener", async () => {
    const add = vi.spyOn(globalThis, "addEventListener");
    const remove = vi.spyOn(globalThis, "removeEventListener");
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    const added = add.mock.calls.map(call => call[0]);

    await app.stop();
    expect(root.childElementCount).toBe(0);
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("[data-frame-layer]")).toBeNull();
    expect(remove.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(added));
  });
});

/**
 * The input of the last run of a command.
 *
 * @param id - Command id.
 * @returns Its input.
 */
function paramsOfLast(id: string): unknown {
  const request = hub.runs(id).at(-1);
  const params = request?.params;
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? params.input
    : undefined;
}
