// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value and Preact's "no props" */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, LinkStatus } from "../../../registry/protocol";
import { definePanel } from "../../define";
import { mountPanel, runFromPanel, scheduleFrame } from "../../mount";
import type { PanelElement, PanelSpec, PanelTools } from "../../types";
import { createDeps, flush, manifestOf, resultOf, type TestDeps } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// mountPanel: the controller of one mounted panel over a mock link and a
// manual frame scheduler — first values, F5 placeholders, stale marking,
// manifest recheck, tools.run → workspace:ran, the error boundary, unmount.
// ─────────────────────────────────────────────────────────────────────────────

type Tools = PanelTools<Readonly<Record<string, string>>>;

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * The Flow-like panel: two sources, one command; the view prints the values.
 *
 * @param view - Optional view spy.
 * @returns The spec.
 */
function flowPanel(
  view: (values: Readonly<Record<string, Json>>, tools: Tools) => PanelElement = values =>
    h("p", { "data-view": "flow" }, JSON.stringify(values))
): PanelSpec {
  return definePanel({
    id: "flow",
    title: "Flow",
    workspace: "flow",
    sources: { position: "game.position", history: ["game.history", { last: 20 }] },
    commands: { step: "game.step" },
    view: (values, tools) => view(values, tools as unknown as Tools)
  });
}

/**
 * The panel's section in the host.
 *
 * @returns The section.
 */
function section(): HTMLElement {
  const found = host.querySelector<HTMLElement>("section[data-panel]");
  if (found === null) throw new Error("no section");
  return found;
}

/**
 * Sends both first values and flushes the frame.
 *
 * @param deps - The deps.
 */
function deliverAll(deps: TestDeps): void {
  deps.linkMock.send("game.position", { path: "home" });
  deps.linkMock.send("game.history", []);
  deps.frames.flush();
}

describe("mountPanel: the section and the watches", () => {
  it("appends one section with the data and aria attributes and watches each source", () => {
    const deps = createDeps();
    mountPanel(flowPanel(), host, deps);
    const element = section();
    expect(element.dataset.panel).toBe("flow");
    expect(element.dataset.panelState).toBe("waiting");
    expect(element.getAttribute("aria-label")).toBe("Flow");
    expect(element.getAttribute("aria-busy")).toBe("true");
    expect(deps.linkMock.watches.map(record => [record.id, record.input])).toEqual([
      ["game.position", undefined],
      ["game.history", { last: 20 }]
    ]);
  });

  it("renders the view only after every source delivered a first value", () => {
    const deps = createDeps();
    const view = vi.fn((_values: Readonly<Record<string, Json>>, _tools: Tools) =>
      h("p", null, "ready")
    );
    mountPanel(flowPanel(view), host, deps);
    deps.linkMock.send("game.position", { path: "home" });
    deps.frames.flush();
    expect(view).not.toHaveBeenCalled();
    expect(section().dataset.panelState).toBe("waiting");

    deps.linkMock.send("game.history", [{ outcome: "play" }]);
    deps.frames.flush();
    expect(view).toHaveBeenCalledTimes(1);
    expect(view.mock.calls[0]?.[0]).toEqual({
      position: { path: "home" },
      history: [{ outcome: "play" }]
    });
    expect(section().dataset.panelState).toBe("ready");
    expect(section().hasAttribute("aria-busy")).toBe(false);
    expect(section().textContent).toBe("ready");
  });

  it("coalesces a burst of 100 values into one render per frame", () => {
    const deps = createDeps();
    const view = vi.fn((_values: Readonly<Record<string, Json>>, _tools: Tools) =>
      h("p", null, "x")
    );
    mountPanel(flowPanel(view), host, deps);
    deps.linkMock.send("game.history", []);
    for (let index = 0; index < 100; index += 1) {
      deps.linkMock.send("game.position", { path: `p${index}` });
    }
    expect(deps.frames.pending()).toBe(1);
    deps.frames.flush();
    expect(view).toHaveBeenCalledTimes(1);
    expect(view.mock.calls[0]?.[0]).toMatchObject({ position: { path: "p99" } });
  });

  it("renders a panel with sources {} at once, in every link state", () => {
    const deps = createDeps({ kind: "empty" });
    const spec = definePanel({
      id: "files",
      title: "Files",
      workspace: "files",
      sources: {},
      view: () => h("p", null, "files view")
    });
    mountPanel(spec, host, deps);
    expect(section().dataset.panelState).toBe("ready");
    expect(section().textContent).toBe("files view");
    expect(deps.linkMock.watch).not.toHaveBeenCalled();
  });

  it("watches a frame source like any other: no timer, no poll", () => {
    vi.useFakeTimers();
    const deps = createDeps();
    const spec = definePanel({
      id: "render",
      title: "Render",
      workspace: "render",
      sources: { render: "game.render" },
      view: values => h("p", null, JSON.stringify(values.render))
    });
    mountPanel(spec, host, deps);
    deps.linkMock.send("game.render", { fps: 60 });
    deps.frames.flush();
    vi.advanceTimersByTime(60_000);
    expect(deps.linkMock.watch).toHaveBeenCalledTimes(1);
    expect(deps.linkMock.api.read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("mountPanel: generic F5 placeholders", () => {
  for (const status of [
    { kind: "empty" },
    { kind: "connecting" },
    { kind: "lost", reason: "socket_closed", lastFrame: 0, retryInMs: 1000 }
  ] as const satisfies readonly LinkStatus[]) {
    it(`shows no-game while ${status.kind} without values`, () => {
      const deps = createDeps(status);
      mountPanel(flowPanel(), host, deps);
      expect(section().dataset.panelState).toBe("no-game");
      expect(section().querySelector("[role='status']")?.textContent).toBe(
        "No game connected · this panel fills in when a game connects."
      );
    });
  }

  it("shows waiting while live without values; spinner text after 400 ms, escalation after 5 s", () => {
    vi.useFakeTimers();
    const deps = createDeps({ kind: "live", frame: 3 });
    mountPanel(flowPanel(), host, deps);
    expect(section().dataset.panelState).toBe("waiting");
    expect(section().querySelector("[role='status']")?.textContent).toBe("");

    vi.advanceTimersByTime(400);
    deps.frames.flush();
    expect(section().querySelector("[role='status']")?.textContent).toBe(
      "Waiting for game.position, game.history…"
    );
    expect(section().querySelector("[data-spinner]")).not.toBeNull();

    deps.linkMock.send("game.position", { path: "home" });
    vi.advanceTimersByTime(4600);
    deps.frames.flush();
    expect(section().querySelector("[role='status']")?.textContent).toBe(
      "No value from game.history yet. Check the source input."
    );
    expect(section().querySelector("[data-spinner]")).toBeNull();

    deps.linkMock.send("game.history", []);
    deps.frames.flush();
    expect(section().dataset.panelState).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names missing sources of the manifest and does not watch them; a later manifest adds them", () => {
    const deps = createDeps();
    deps.linkMock.manifestValue = manifestOf(["game.position"]);
    const panel = mountPanel(flowPanel(), host, deps);
    expect(panel.missing).toEqual(["game.history"]);
    expect(deps.linkMock.watches.map(record => record.id)).toEqual(["game.position"]);
    deps.linkMock.send("game.position", { path: "home" });
    deps.frames.flush();
    expect(section().dataset.panelState).toBe("missing");
    expect(section().querySelector("[role='status']")?.textContent).toBe(
      "This game does not provide game.history."
    );

    panel.recheck(manifestOf(["game.position", "game.history"]));
    expect(panel.missing).toEqual([]);
    expect(deps.linkMock.active("game.history")).toHaveLength(1);
    expect(deps.linkMock.active("game.position")).toHaveLength(1);
    deps.linkMock.send("game.history", []);
    deps.frames.flush();
    expect(section().dataset.panelState).toBe("ready");
  });

  it("drops the watch of a source that vanished from the manifest", () => {
    const deps = createDeps();
    const panel = mountPanel(flowPanel(), host, deps);
    deliverAll(deps);
    panel.recheck(manifestOf(["game.position"]));
    expect(deps.linkMock.active("game.history")).toHaveLength(0);
    deps.frames.flush();
    expect(section().dataset.panelState).toBe("missing");

    panel.recheck(undefined);
    expect(panel.missing).toEqual([]);
    expect(deps.linkMock.active("game.history")).toHaveLength(1);
  });
});

describe("mountPanel: status and stale marking", () => {
  it("marks data-stale for every LinkStatus kind; resync clears when every key is fresh", () => {
    const deps = createDeps({ kind: "live", frame: 1 });
    const panel = mountPanel(flowPanel(), host, deps);
    deliverAll(deps);
    expect(section().dataset.stale).toBeUndefined();

    panel.setStatus({ kind: "silent", since: 1, lastFrame: 1 });
    expect(section().dataset.stale).toBe("silent");
    panel.setStatus({ kind: "lost", reason: "socket_closed", lastFrame: 1, retryInMs: 1000 });
    expect(section().dataset.stale).toBe("lost");
    panel.setStatus({ kind: "empty" });
    expect(section().dataset.stale).toBe("lost");
    panel.setStatus({ kind: "connecting" });
    expect(panel.fresh.size).toBe(0);
    expect(section().dataset.stale).toBe("resync");
    panel.setStatus({ kind: "live", frame: 2 });
    expect(section().dataset.stale).toBe("resync");

    deps.linkMock.send("game.position", { path: "board" });
    deps.frames.flush();
    expect(section().dataset.stale).toBe("resync");
    deps.linkMock.send("game.history", []);
    deps.frames.flush();
    expect(section().dataset.stale).toBeUndefined();

    panel.setStatus({ kind: "paused", frame: 3 });
    expect(section().dataset.stale).toBeUndefined();
  });

  it("tools.status follows setStatus: each status change schedules a render", () => {
    const deps = createDeps({ kind: "live", frame: 1 });
    const statuses: string[] = [];
    const panel = mountPanel(
      flowPanel((_values, tools) => {
        statuses.push(tools.status.kind);
        return h("p", null);
      }),
      host,
      deps
    );
    deliverAll(deps);
    panel.setStatus({ kind: "paused", frame: 2 });
    deps.frames.flush();
    panel.setStatus({ kind: "silent", since: 5, lastFrame: 2 });
    deps.frames.flush();
    expect(statuses).toEqual(["live", "paused", "silent"]);
  });
});

/** The fixed clock of the run tests: `at` is Date.now() when the call settled. */
const NOW = 1_700_000_000_000;

describe("mountPanel: tools", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  it("tools.run.step calls link.run once and emits one workspace:ran with origin panel", async () => {
    const deps = createDeps();
    deps.linkMock.run.mockResolvedValue(resultOf(1841));
    let tools: Tools | undefined;
    mountPanel(
      flowPanel((_values, given) => {
        tools = given;
        return h("p", null);
      }),
      host,
      deps
    );
    deliverAll(deps);
    const result = await tools?.run.step?.({ frames: 1 });
    expect(result).toEqual(resultOf(1841));
    expect(deps.linkMock.run).toHaveBeenCalledTimes(1);
    expect(deps.linkMock.run).toHaveBeenCalledWith("game.step", { frames: 1 });
    expect(deps.emit).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith("workspace:ran", {
      id: "game.step",
      input: { frames: 1 },
      origin: "panel",
      at: NOW,
      ok: true,
      result: resultOf(1841)
    });
  });

  it("a rejected run emits ok: false with the WireError and still rejects", async () => {
    const deps = createDeps();
    const failure = Object.assign(new Error("[moku-editor] no session"), {
      code: -32_003,
      data: { reason: "no_session" as const, retryable: false }
    });
    deps.linkMock.run.mockRejectedValue(failure);
    await expect(runFromPanel(deps, "game.step", { frames: 1 }, "panel")).rejects.toBe(failure);
    expect(deps.emit).toHaveBeenCalledWith("workspace:ran", {
      id: "game.step",
      input: { frames: 1 },
      origin: "panel",
      at: NOW,
      ok: false,
      error: {
        code: -32_003,
        message: "[moku-editor] no session",
        data: { reason: "no_session", retryable: false }
      }
    });
  });

  it("hands the view channel, files and workspace; channel.run also reports workspace:ran", async () => {
    const deps = createDeps();
    let tools: Tools | undefined;
    mountPanel(
      flowPanel((_values, given) => {
        tools = given;
        return h("p", null);
      }),
      host,
      deps
    );
    deliverAll(deps);
    expect(tools?.files).toBe(deps.link.files);
    expect(tools?.workspace).toBe(deps.workspace);
    await tools?.channel.read("game.rect", { key: "coins" });
    expect(deps.link.read).toHaveBeenCalledWith("game.rect", { key: "coins" });
    expect(tools?.channel.status()).toEqual(deps.linkMock.current);
    const stop = tools?.channel.watch("game.log", undefined, () => {});
    expect(typeof stop).toBe("function");
    await tools?.channel.run("game.pause");
    expect(deps.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "game.pause", input: undefined, origin: "panel", ok: true })
    );
  });

  it("builds the run map once: the same functions across renders", () => {
    const deps = createDeps();
    const runs: Tools["run"][] = [];
    const panel = mountPanel(
      flowPanel((_values, tools) => {
        runs.push(tools.run);
        return h("p", null);
      }),
      host,
      deps
    );
    deliverAll(deps);
    panel.setStatus({ kind: "paused", frame: 2 });
    deps.frames.flush();
    expect(runs).toHaveLength(2);
    expect(runs[0]).toBe(runs[1]);
  });
});

describe("mountPanel: errors and unmount", () => {
  it("a throwing view shows the error state and logs; a sibling panel still renders", async () => {
    const deps = createDeps();
    const sibling = document.createElement("div");
    document.body.append(sibling);
    mountPanel(
      flowPanel(() => {
        throw new Error("boom");
      }),
      host,
      deps
    );
    const other = definePanel({
      id: "flow.notes",
      title: "Notes",
      workspace: "flow",
      sources: {},
      view: () => h("p", null, "notes")
    });
    mountPanel(other, sibling, deps);
    deliverAll(deps);
    await flush();
    expect(section().dataset.panelState).toBe("error");
    expect(section().querySelector("[role='status']")?.textContent).toBe(
      "This panel failed · boom"
    );
    expect(deps.log.error).toHaveBeenCalledWith("panels:view-failed", {
      id: "flow",
      message: "boom"
    });
    expect(sibling.textContent).toBe("notes");

    deps.linkMock.send("game.position", { path: "board" });
    deps.frames.flush();
    await flush();
    expect(section().dataset.panelState).toBe("error");
  });

  it("unmount calls every unwatch, empties and removes the section; later values do nothing", () => {
    vi.useFakeTimers();
    const deps = createDeps();
    const view = vi.fn(() => h("p", null));
    const panel = mountPanel(flowPanel(view), host, deps);
    const element = section();
    expect(deps.linkMock.active()).toHaveLength(2);
    deps.linkMock.send("game.position", { path: "home" });
    panel.unmount();
    expect(deps.linkMock.active()).toHaveLength(0);
    expect(element.childNodes).toHaveLength(0);
    expect(host.querySelector("section")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    deps.frames.flush();
    panel.setStatus({ kind: "live", frame: 9 });
    deps.frames.flush();
    expect(view).not.toHaveBeenCalled();
    panel.unmount();
  });
});

describe("scheduleFrame", () => {
  it("uses requestAnimationFrame when present", () => {
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    const render = vi.fn();
    scheduleFrame(render);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("falls back to a microtask without requestAnimationFrame", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const render = vi.fn();
    scheduleFrame(render);
    expect(render).not.toHaveBeenCalled();
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
