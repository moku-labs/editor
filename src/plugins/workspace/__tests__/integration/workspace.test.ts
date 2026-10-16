// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { activeSourcePlugin } from "../../../activeSource";
import type { SessionDevice } from "../../../hub/protocol";
import { linkPlugin } from "../../../link";
import type {
  CommandDescriptor,
  Json,
  Manifest,
  Response as RpcResponse,
  SessionInfo,
  ToolsBoot
} from "../../../registry/protocol";
import { decode, encode, isResponse, request, WORKSPACE_NAMES } from "../../../registry/protocol";
import { workspacePlugin } from "../..";
import type { RanEvent, WorkspaceId } from "../../types";
import { createScriptedHub, type ScriptedHub } from "./fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// A tools core with the real link, activeSource and workspace over a scripted
// hub: createApp → start → mount → keys, top bar, stale bar, D-07 reload, the
// source pill, veil and notice, startLocalPreview → stop
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, activeSourcePlugin, workspacePlugin]
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

/** A Galaxy A26 linked by wire. */
const A26: SessionDevice = {
  id: "d-7f3a",
  model: "SM-A266B",
  link: "adb",
  address: "127.0.0.1",
  port: 47_600,
  engine: "0.15.0+9c41e0",
  build: "debug-20261016T090000Z"
};

/**
 * The session of this page's own game frame: embedded, tagged with the page's frame id.
 *
 * @param url - The tagged game URL (`app.link.frameUrl(...)`).
 * @returns The session.
 */
function ownSessionOf(url: string): SessionInfo {
  return { id: "s-1", game: "merge-game 0.0.0", page: url, embedded: true, connectedAt: 1000 };
}

/**
 * A phone's session.
 *
 * @returns The session.
 */
function deviceSessionOf(): SessionInfo {
  return {
    id: "s-9",
    game: "merge-game 0.0.0",
    page: "http://localhost/index.html",
    embedded: false,
    connectedAt: 2000,
    device: A26
  };
}

/**
 * The source pill's text.
 *
 * @returns The text, undefined without a pill.
 */
function pill(): string | null | undefined {
  return root.querySelector("[data-ui='source-pill']")?.textContent;
}

/**
 * The paused veil of the game frame.
 *
 * @returns The element, null without one.
 */
function veil(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-frame-veil]");
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

  it("a scenario picked after the first listing starts the frame from it: player=full, new session", async () => {
    hub.listings.set("tests/scenarios", [
      { path: "tests/scenarios/full.ts", kind: "file", size: 9 },
      { path: "tests/scenarios/full.test.ts", kind: "file", size: 9 }
    ]);
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.open(sessionOf("s-1"), manifestOf());
    await until(() => app.workspace.scenarios().scenarios.length === 1, "the first listing");
    expect(app.workspace.scenarios()).toEqual({ scenarios: ["full"], chosen: undefined });
    await until(() => app.link.manifest() !== undefined, "attach");

    const pending = app.workspace.setScenario("full");
    const iframe = document.querySelector<HTMLIFrameElement>("iframe[data-game-frame]");
    expect(new URL(iframe?.src ?? "").searchParams.get("player")).toBe("full");
    hub.close("s-1", "game_reloaded");
    hub.open(sessionOf("s-2"), manifestOf());

    await expect(pending).resolves.toEqual({ restored: false });
    expect(app.link.session()).toBe("s-2");
    expect(hub.runs("game.bookmark")).toEqual([]);
    expect(ran).toEqual([]);
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

  it("the hub's editor.show and editor.device requests change the page like a click and answer it", async () => {
    const sent = vi.spyOn(hub.Socket.prototype, "send");
    /**
     * Sends an editor-channel request to the page, as the hub relays one of the MCP bridge.
     *
     * @param id - The request id.
     * @param method - "show" or "device".
     * @param params - The request params.
     */
    const ask = (id: number, method: string, params: Json): void => {
      hub.sockets[0]?.deliver(encode(request(id, "editor", method, params)));
    };
    /**
     * The page's answer to a request.
     *
     * @param id - The request id.
     * @returns The response, undefined until the page sent it.
     */
    const answerTo = (id: number): RpcResponse | undefined => {
      for (const [text] of sent.mock.calls) {
        const message = typeof text === "string" ? decode(text) : undefined;
        if (message !== undefined && isResponse(message) && message.id === id) return message;
      }
      return undefined;
    };

    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    await until(() => hub.sockets.length === 1, "the hub socket");

    ask(1, "show", { workspace: "state" });
    await until(() => answerTo(1) !== undefined, "the show answer");
    expect(answerTo(1)).toMatchObject({
      result: { workspace: "state", workspaces: [...WORKSPACE_NAMES] }
    });
    expect(app.workspace.active()).toBe("state");
    expect(changed).toEqual(["state"]);
    expect(location.hash).toBe("#state");

    ask(2, "device", { preset: "pixel-8", orientation: "landscape" });
    await until(() => answerTo(2) !== undefined, "the device answer");
    expect(answerTo(2)).toMatchObject({
      result: { preset: "pixel-8", orientation: "landscape", folded: true, w: 915, h: 412 }
    });
    expect(app.workspace.device()).toMatchObject({
      preset: { id: "pixel-8" },
      orientation: "landscape"
    });
    expect(JSON.parse(localStorage.getItem("moku-editor") ?? "{}").device).toEqual({
      preset: "pixel-8",
      orientation: "landscape"
    });

    ask(3, "device", { preset: "nokia" });
    await until(() => answerTo(3) !== undefined, "the error answer");
    expect(answerTo(3)).toMatchObject({
      error: { code: -32_602, data: { reason: "invalid_input", field: "preset" } }
    });
    expect(app.workspace.device().preset.id).toBe("pixel-8");

    ask(4, "show", {});
    await until(() => answerTo(4) !== undefined, "the read answer");
    expect(answerTo(4)).toMatchObject({ result: { workspace: "state" } });
    expect(changed).toEqual(["state"]);
    await app.stop();
  });

  it("Copy on select is on by default, persists when turned off and is read back at the next start (U5)", async () => {
    const app = createApp();
    await app.start();
    expect(app.workspace.copyOnSelect()).toBe(true);
    const seen: boolean[] = [];
    app.workspace.onPrefs(prefs => seen.push(prefs.copyOnSelect));

    app.workspace.setCopyOnSelect(false);
    app.workspace.setCopyOnSelect(false);
    expect(app.workspace.copyOnSelect()).toBe(false);
    expect(seen).toEqual([false]);
    expect(JSON.parse(localStorage.getItem("moku-editor") ?? "{}").copyOnSelect).toBe(false);
    await app.stop();

    const next = createApp();
    await next.start();
    expect(next.workspace.copyOnSelect()).toBe(false);
    await next.stop();
  });

  it("the compact bar shows the game mark; the ⋯ menu has no Copy on select row; R and Reference mode are gone", async () => {
    vi.stubGlobal("innerWidth", 480);
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    expect(root.querySelector("[data-mark]")?.textContent).toBe("·");
    hub.open(sessionOf("s-1"), manifestOf());
    await until(() => app.link.manifest() !== undefined, "attach");
    await until(() => root.querySelector("[data-mark]")?.textContent === "MG", "the mark");
    expect(
      root.querySelector<HTMLElement>("[data-mark]")?.style.getPropertyValue("--mark-hue")
    ).toBe("288");
    expect(root.querySelector("[data-logo]")).toBeNull();

    // R is a free key: nothing marks the frame, no control answers to it.
    act(() => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    });
    expect(document.querySelector("[data-frame-box]")?.hasAttribute("data-reference")).toBe(false);
    expect(root.querySelector("[data-action='reference']")).toBeNull();

    act(() => root.querySelector<HTMLButtonElement>("[data-action='more']")?.click());
    const menu = root.querySelector<HTMLElement>("[data-ui='more-menu']");
    expect(menu?.querySelector("[data-action='reference']")).toBeNull();
    // Copy on select left the top bar (D-72): the preference stays, its control is gameView's.
    expect(menu?.querySelectorAll("[role^='menuitem']")).toHaveLength(6);
    expect(root.querySelector("[data-action='copy-on-select']")).toBeNull();
    expect(app.workspace.copyOnSelect()).toBe(true);
    await app.stop();
  });

  it("startLocalPreview before mount mounts the one frame and resolves when its session opens", async () => {
    const app = createApp();
    await app.start();
    const pending = app.workspace.startLocalPreview();
    expect(document.querySelectorAll("iframe[data-game-frame]")).toHaveLength(1);

    hub.open(ownSessionOf(app.link.frameUrl("http://127.0.0.1:3000/game.html")), manifestOf());
    await expect(pending).resolves.toBeUndefined();
    expect(app.link.ownSession()).toBe("s-1");

    act(() => app.workspace.mount(root));
    expect(document.querySelectorAll("iframe[data-game-frame]")).toHaveLength(1);
    await expect(app.workspace.startLocalPreview()).resolves.toBeUndefined();
    await app.stop();
  });

  it("a phone linking becomes the source: pill, veil over the paused frame; its loss shows the notice", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.answers.set("game.pause", () => ({ value: true }));
    hub.open(ownSessionOf(app.link.frameUrl("http://127.0.0.1:3000/game.html")), manifestOf());
    await until(() => app.activeSource.current().session === "s-1", "the local preview");
    expect(pill()).toBe("Local preview");

    hub.open(deviceSessionOf(), manifestOf());
    await until(() => app.activeSource.current().kind === "device", "the phone as the source");
    expect(hub.runs("game.pause")).toHaveLength(1);
    await until(() => pill() === "SM-A266B · by wire", "the pill names the phone");
    await until(() => veil()?.hidden === false, "the veil");
    expect(veil()?.textContent).toContain("SM-A266B is the source.");

    hub.close("s-9", "bye");
    await until(() => app.activeSource.current().kind === "local", "back on the local preview");
    await until(
      () => root.querySelector("[data-ui='source-notice'] [data-part='bar']") !== null,
      "the notice"
    );
    expect(root.querySelector("[data-ui='source-notice']")?.textContent).toContain(
      "SM-A266B disconnected."
    );
    await until(() => veil()?.hidden === true, "the veil gone");
    expect(pill()).toBe("Local preview");
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
