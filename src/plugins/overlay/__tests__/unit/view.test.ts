// @vitest-environment happy-dom
/* eslint-disable sonarjs/no-hardcoded-ip -- addresses a phone types into the Link tab */
/* eslint-disable unicorn/no-null -- null is the engine's and perf's "not measured" */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PerfSpikeRecord } from "../../../perf/protocol";
import { openOverlay, setTab } from "../../modes";
import { PAINT_MS } from "../../types";
import {
  createOctx,
  GARDEN_COMMANDS,
  logFile,
  part,
  RECORDING,
  secondOf,
  shadowOf,
  started,
  stopped,
  type TestOctx
} from "../helpers";

let octx: TestOctx;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  stopped(octx);
  vi.useRealTimers();
});

/**
 * A started card with the design's Game tab commands.
 *
 * @param commands - Whether the game registered overlay commands.
 * @returns The context.
 */
function card(commands = true): TestOctx {
  octx = started(createOctx({ remember: false }, commands ? GARDEN_COMMANDS : []));
  octx.registry.values.set("garden.glow", false);
  openOverlay(octx);
  return octx;
}

/**
 * A spike record of a frame.
 *
 * @param frame - The frame.
 * @returns The record.
 */
function recordOf(frame: number): PerfSpikeRecord {
  return {
    frame,
    agoMs: 980,
    ms: 41.3,
    budgetMs: 16.7,
    overMs: 24.6,
    cause: "upload",
    causes: ["upload", "gap"],
    jsMs: 8,
    gpuMs: 6.6,
    path: "garden/boss",
    why: "41.0 MB of textures uploaded this frame (bundle garden-boss)",
    at: null,
    fps: 60,
    rateSwitch: null,
    gapMs: 41.3,
    drawn: true,
    gpuPartial: false,
    phases: null,
    passes: null,
    draws: null,
    filters: null,
    uploads: null,
    compiles: null,
    changed: [],
    events: [],
    detail: null
  };
}

/**
 * Clicks an element of the overlay.
 *
 * @param selector - The selector.
 */
function click(selector: string): void {
  part(octx, selector).click();
}

/**
 * The canvases in the shadow root.
 *
 * @returns The canvases.
 */
function canvases(): HTMLCanvasElement[] {
  return [...shadowOf(octx).querySelectorAll("canvas")];
}

/**
 * Elements with a class attribute anywhere in the shadow root.
 *
 * @returns Their count.
 */
function classes(): number {
  return shadowOf(octx).querySelectorAll("[class]").length;
}

describe("C3: one canvas per graph", () => {
  it("keeps the same canvas across ticks and none on other tabs or in the pill", () => {
    card();
    expect(canvases()).toHaveLength(1);
    const first = canvases()[0];
    vi.advanceTimersByTime(PAINT_MS * 3);
    expect(canvases()).toEqual([first]);
    setTab(octx, "record");
    expect(canvases()).toHaveLength(0);
    setTab(octx, "frames");
    expect(canvases()).toHaveLength(1);
    openOverlay(octx, { mode: "pill" });
    expect(canvases()).toHaveLength(0);
  });

  it("the record view keeps the canvas (it has none)", () => {
    card();
    octx.perf.records.set(4805, recordOf(4805));
    octx.state.graph = octx.graph.createState(64);
    octx.graph.hitSpike = 2;
    part(octx, "canvas").dispatchEvent(new MouseEvent("click", { clientX: 40, clientY: 8 }));
    expect(canvases()).toHaveLength(0);
    expect(part(octx, "[data-record]").dataset.record).toBe("4805");
  });

  it("the Frames tab without a monitor still creates a canvas (it shows the note)", () => {
    octx = createOctx({ remember: false });
    octx.perf.statusValue = { state: "off", reason: "no-monitor" };
    started(octx);
    openOverlay(octx);
    expect(canvases()).toHaveLength(0);
    expect(part(octx, '[data-part="note"]').textContent).toContain(
      "No frame monitor in this build."
    );
    expect(shadowOf(octx).querySelector("[data-counter]")).toBeNull();
    expect(part(octx, '[data-part="header"] [data-part="fps"] b').textContent).toBe("—");
  });

  it("waiting shows the empty well and the note", () => {
    octx = createOctx({ remember: false });
    octx.perf.statusValue = { state: "waiting" };
    started(octx);
    openOverlay(octx);
    expect(canvases()).toHaveLength(0);
    expect(shadowOf(octx).querySelector("[data-graph]")).not.toBeNull();
    expect(part(octx, '[data-part="note"]').textContent).toBe("Waiting for the first frames.");
  });
});

describe("the graph", () => {
  it("a graph tap on a flag selects instead of opening the record (it opens it); back returns", () => {
    card();
    octx.perf.records.set(4809, recordOf(4809));
    octx.graph.hitSpike = 6;
    part(octx, "canvas").dispatchEvent(new MouseEvent("click", { clientX: 120, clientY: 8 }));
    expect(octx.state.record).toBe(4809);
    expect(part(octx, '[data-part="lead"] [data-part="word"]').textContent).toBe("Upload");
    click('[data-action="back"]');
    expect(octx.state.record).toBeUndefined();
    expect(octx.state.selected).toBe(4809);
    expect(canvases()).toHaveLength(1);
  });

  it("a tap off the spikes selects that frame", () => {
    card();
    octx.state.graph = octx.graph.createState(64);
    octx.graph.hitRow = 4;
    part(octx, "canvas").dispatchEvent(new MouseEvent("click", { clientX: 60, clientY: 70 }));
    expect(octx.state.selected).toBe(4807);
    expect(octx.state.record).toBeUndefined();
  });

  it("prev / next walk the spikes and wrap; the counter follows", () => {
    card();
    expect(part(octx, '[data-part="count"]').textContent).toBe("3/3");
    click('[data-spike-nav="next"]');
    expect(octx.state.selected).toBe(4805);
    expect(part(octx, '[data-part="count"]').textContent).toBe("1/3");
    click('[data-spike-nav="prev"]');
    expect(octx.state.selected).toBe(4812);
  });

  it("prev / next switch an open record", () => {
    card();
    for (const frame of [4805, 4809, 4812]) octx.perf.records.set(frame, recordOf(frame));
    octx.state.record = 4809;
    octx.state.selected = 4809;
    vi.advanceTimersByTime(PAINT_MS);
    click('[data-record] [data-spike-nav="next"]');
    expect(octx.state.record).toBe(4812);
    expect(part(octx, "[data-record]").dataset.record).toBe("4812");
  });

  it("a record whose spike left the window disappears (it stays, the counter reads –/n)", () => {
    card();
    octx.perf.records.set(4700, recordOf(4700));
    octx.state.record = 4700;
    vi.advanceTimersByTime(PAINT_MS);
    octx.perf.records.clear();
    vi.advanceTimersByTime(PAINT_MS);
    expect(part(octx, "[data-record]").dataset.record).toBe("4700");
    expect(part(octx, '[data-record] [data-part="count"]').textContent).toBe("–/3");
    octx.state.recordCopy = undefined;
    vi.advanceTimersByTime(PAINT_MS);
    expect(shadowOf(octx).querySelector("[data-record]")).toBeNull();
  });

  it("disables prev / next without spikes and shows NO GPU TIMER without a timer", () => {
    octx = createOctx({ remember: false });
    octx.perf.window.spikes = [];
    octx.perf.window.spikeCount = 0;
    octx.perf.statusValue = { state: "on", lost: 0, gpuTimer: false };
    started(octx);
    openOverlay(octx);
    expect(part<HTMLButtonElement>(octx, '[data-spike-nav="next"]').disabled).toBe(true);
    expect(part(octx, '[data-part="count"]').textContent).toBe("–/0");
    expect(part(octx, "[data-graph] [data-legend]").textContent).toBe("NO GPU TIMER");
    expect(shadowOf(octx).querySelector('[data-counter="device"]')).not.toBeNull();
  });
});

describe("the card", () => {
  it("the key bar has four keys with no overlay commands (it has three)", () => {
    card(false);
    const keys = [...shadowOf(octx).querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(keys.map(key => key.dataset.tab)).toEqual(["frames", "record", "link"]);
    expect(keys[0]?.getAttribute("aria-selected")).toBe("true");
    stopped(octx);
    card(true);
    expect(shadowOf(octx).querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it("the engine line shows on the Link tab (only on Frames, or inline with a live link)", () => {
    card();
    expect(part(octx, '[data-part="engine"]').textContent).toContain("engine 0.14.12+9c41e0");
    expect(part(octx, '[data-part="engine"]').textContent).toContain(
      "build debug-20261014T160000Z"
    );
    setTab(octx, "link");
    expect(shadowOf(octx).querySelector('[data-part="engine"]')).toBeNull();
    setTab(octx, "record");
    expect(shadowOf(octx).querySelector('[data-part="engine"]')).toBeNull();
  });

  it("More or the key bar offers a kept-pictures switch (neither does)", () => {
    card();
    click("[data-more]");
    const xtra = part(octx, '[data-part="xtra"]');
    expect(xtra.textContent).toContain("kept 4 pictures, 0 retakes");
    expect(xtra.querySelector("button")).toBeNull();
    const switches = [
      ...shadowOf(octx).querySelectorAll<HTMLElement>("button:not([data-more])")
    ].map(button => `${button.textContent ?? ""} ${button.dataset.action ?? ""}`);
    expect(switches.some(text => /kept/i.test(text))).toBe(false);
    expect(
      [...shadowOf(octx).querySelectorAll('[role="tablist"] button')].map(key => key.textContent)
    ).toEqual(["Frames", "Game", "Record", "Link"]);
    expect(part(octx, "[data-more]").dataset.more).toBe("open");
  });

  it("a class attribute appears in the shadow root (none, in every view)", () => {
    card();
    click("[data-more]");
    expect(classes()).toBe(0);
    for (const tab of ["game", "record", "link"] as const) {
      setTab(octx, tab);
      expect(classes()).toBe(0);
    }
    openOverlay(octx, { mode: "pill" });
    expect(classes()).toBe(0);
  });

  it("STALE takes the link legend's place in the header; REC stays", () => {
    octx = createOctx({ remember: false });
    octx.recorder.statusValue = RECORDING;
    started(octx, true);
    octx.state.link = {
      status: { kind: "live", frame: 1 },
      link: { mode: "adb", address: "127.0.0.1:47600", editorEngine: "0.14.13+1ab7f2" }
    };
    openOverlay(octx);
    expect(part(octx, '[data-part="header"] [data-link]').dataset.link).toBe("stale");
    expect(shadowOf(octx).querySelector('[data-part="header"] [data-rec]')).not.toBeNull();
    expect(part(octx, '[data-part="engine"]').dataset.stale !== undefined).toBe(true);
    expect(part(octx, '[data-tab="record"] [data-rec]')).toBeDefined();
  });

  it("collapses to the pill and hides from the header keys", () => {
    card();
    click('[data-action="collapse"]');
    expect(octx.state.mode).toBe("pill");
    const pill = part(octx, '[data-overlay="pill"]');
    expect(pill.getAttribute("aria-label")).toBe("54 fps, 6 spikes, 6 s. Open the overlay");
    pill.click();
    expect(octx.state.mode).toBe("card");
    click('[data-action="hide"]');
    expect(octx.state.mode).toBe("hidden");
  });

  it("draws the counters with the rate suffix and the compact card's key", () => {
    octx = createOctx({ remember: false });
    octx.perf.secondValue = secondOf({
      rate: { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }
    });
    started(octx);
    openOverlay(octx);
    const fps = part(octx, '[data-counter="fps"]');
    expect(fps.textContent).toBe("drawn / loop54 / 60 @60fps");
    expect(fps.getAttribute("title")).toBe("60 fps, auto (missed); display 120 Hz");
    expect(part(octx, '[data-part="rate"]').dataset.caution !== undefined).toBe(true);
    stopped(octx);
    octx = createOctx({ remember: false });
    Object.defineProperty(globalThis, "innerWidth", { configurable: true, value: 360 });
    started(octx);
    openOverlay(octx);
    Reflect.deleteProperty(globalThis, "innerWidth");
    expect(shadowOf(octx).querySelectorAll("[data-counter]")).toHaveLength(3);
    expect(part(octx, '[data-counter="fps"] i').textContent).toBe("fps @60");
    expect(part(octx, '[data-counter="fps"]').getAttribute("title")).toBe(
      "drawn / loop · 60 fps, fixed; display 60 Hz"
    );
    expect(part(octx, '[data-counter="fps"] b').textContent).toBe("54 / 60");
    expect(part(octx, '[data-overlay="card"]').dataset.compact !== undefined).toBe(true);
    click('[data-part="counters"] [data-more]');
    expect(part(octx, '[data-part="xtra"]').textContent).toContain("passes — · draws —");
  });

  it("shows the offline note in device mode with no computer", () => {
    octx = started(createOctx({ remember: false }), true);
    octx.state.link = {
      status: { kind: "connecting" },
      link: { mode: "none", address: "127.0.0.1:47600" }
    };
    openOverlay(octx);
    expect(part(octx, '[data-part="offnote"]').textContent).toContain("Logs stay on the phone");
  });
});

describe("the Game, Record and Link tabs", () => {
  it("presses a toggle and toasts", async () => {
    card();
    setTab(octx, "game");
    expect(part(octx, '[data-part="game-by"]').textContent).toBe("Added by A Memory Missing");
    expect(part(octx, '[data-command="garden.glow"]').dataset.state).toBe("off");
    expect(part(octx, '[data-command="story.skipDialogue"]').getAttribute("aria-disabled")).toBe(
      "true"
    );
    expect(part(octx, '[data-part="game-note"]').textContent).toContain("READ-ONLY");
    click('[data-command="garden.glow"]');
    await vi.waitFor(() => {
      expect(part(octx, "[data-toast]").textContent).toBe("Glow on.");
    });
    expect(octx.channel.runs).toEqual([{ id: "garden.glow", input: { on: true }, via: "overlay" }]);
    vi.advanceTimersByTime(3000 + PAINT_MS);
    expect(shadowOf(octx).querySelector("[data-toast]")).toBeNull();
    expect(part(octx, '[data-part="press-note"]').textContent).toBe(
      "Each press is written to the log as a mark."
    );
  });

  it("drives the recorder from the Record tab", async () => {
    card();
    setTab(octx, "record");
    expect(part(octx, '[data-part="clock"]').textContent).toBe("00:00");
    click('[data-action="start"]');
    expect(octx.recorder.calls).toEqual(["start"]);
    expect(part(octx, "[data-toast]").textContent).toBe("Recording started.");
    expect(part(octx, '[data-part="clock"]').textContent).toBe("03:12");
    const field = part<HTMLInputElement>(octx, '[data-part="field"]');
    field.value = "boss phase 2";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    click('[data-action="mark"]');
    expect(octx.recorder.calls.at(-1)).toBe("mark:boss phase 2");
    expect(part(octx, "[data-toast]").textContent).toBe("Mark added at 03:12.");
    octx.recorder.filesValue = [
      logFile("perf-a.jsonl"),
      logFile("perf-b.jsonl", { current: true })
    ];
    octx.recorder.marksValue = [{ atMs: 64_000, label: "boss enters", auto: false }];
    vi.advanceTimersByTime(PAINT_MS);
    expect(part(octx, '[data-part="marks"]').textContent).toBe("01:04boss enters");
    const deletes = [
      ...shadowOf(octx).querySelectorAll<HTMLButtonElement>('[data-action="delete"]')
    ];
    expect(deletes.map(button => button.disabled)).toEqual([false, true]);
    click('[data-action="share"]');
    await vi.waitFor(() => {
      expect(part(octx, "[data-toast]").textContent).toBe("Share sheet opened for perf-a.jsonl.");
    });
    octx.recorder.shareAnswer = "cancelled";
    click('[data-action="share"]');
    await vi.waitFor(() => {
      expect(part(octx, "[data-toast]").textContent).toBe("Share cancelled.");
    });
    octx.recorder.shareAnswer = "downloaded";
    click('[data-action="share"]');
    await vi.waitFor(() => {
      expect(part(octx, "[data-toast]").textContent).toBe("Downloaded perf-a.jsonl.");
    });
    deletes[0]?.click();
    await vi.waitFor(() => {
      expect(part(octx, "[data-toast]").textContent).toBe("Deleted perf-a.jsonl.");
    });
    click('[data-action="stop"]');
    await vi.waitFor(() => {
      expect(part(octx, "[data-toast]").textContent).toBe(
        "Recording stopped, log kept on the phone."
      );
    });
  });

  it("toasts a recorder failure without its prefix", async () => {
    card();
    setTab(octx, "record");
    octx.recorder.failStart = new Error(
      "[moku-editor] recorder.start needs a frame monitor.\n  Use a debug build."
    );
    click('[data-action="start"]');
    expect(part(octx, '[data-toast="error"]').textContent).toBe(
      "recorder.start needs a frame monitor."
    );
    octx.recorder.mark = () => false;
    click('[data-action="mark"]');
    expect(part(octx, '[data-toast="error"]').textContent).toBe(
      "Not recording: start a log to add marks."
    );
  });

  it("connects from the Link tab and shows the hint for a bad address", () => {
    octx = started(createOctx({ remember: false }), true);
    octx.state.link = {
      status: { kind: "connecting" },
      link: { mode: "none", address: "127.0.0.1:47600" }
    };
    openOverlay(octx, { tab: "link" });
    const field = part<HTMLInputElement>(octx, '[data-part="address"] [data-part="field"]');
    field.value = "192.168.1.5";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    click('[data-action="connect"]');
    expect(part(octx, '[data-part="hint"]').textContent).toBe(
      "Use host:port, for example 192.168.1.5:47600."
    );
    const again = part<HTMLInputElement>(octx, '[data-part="address"] [data-part="field"]');
    again.value = "192.168.1.5:47600";
    again.dispatchEvent(new Event("input", { bubbles: true }));
    click('[data-action="connect"]');
    expect(octx.emitted.filter(([name]) => name === "overlay:connect")).toEqual([
      ["overlay:connect", { address: "192.168.1.5:47600" }]
    ]);
    octx.state.link = {
      status: { kind: "connecting" },
      link: {
        mode: "connecting",
        address: "192.168.1.5:47600",
        pairing: { code: "4821" },
        editorEngine: "0.14.13"
      }
    };
    vi.advanceTimersByTime(PAINT_MS);
    expect(part(octx, "[data-pairing]").dataset.pairing).toBe("4821");
    expect(part(octx, "[data-pairing]").textContent).toContain("moku-editor perf terminal");
    expect(part(octx, "[data-caution]").textContent).toContain("the computer has 0.14.13");
    octx.state.link = {
      status: { kind: "live", frame: 1 },
      link: { mode: "lan", address: "192.168.1.5:47600", seenAt: Date.now() - 2000 }
    };
    vi.advanceTimersByTime(PAINT_MS);
    expect(part(octx, '[data-part="live"]').textContent).toBe("Live via LANlast seen 2 s ago");
    expect(part(octx, '[data-part="engine"]').dataset.inline !== undefined).toBe(true);
  });
});
