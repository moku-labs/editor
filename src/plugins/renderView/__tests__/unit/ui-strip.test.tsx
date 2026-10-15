// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- Preact renders null for "nothing" */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelTools } from "../../../panels/types";
import { CAUSE_RANK } from "../../../perf/protocol";
import type { LinkStatus, SessionInfo } from "../../../registry/protocol";
import { toWireValue } from "../../../registry/protocol";
import { createRenderViewApi } from "../../api";
import { deriveSnapshot } from "../../derive";
import { CAUSE_STYLE, causeHue, GRAPH_PALETTES, rowAt, spikeAt } from "../../device/contract";
import { createHandlers } from "../../handlers";
import { startRenderView, stopRenderView } from "../../lifecycle";
import { createRenderPanel } from "../../panel";
import {
  COMPUTER_ENGINE,
  DEVICE,
  deviceSession,
  recorderOf,
  recordOf,
  secondOf,
  spikesOf,
  windowWire,
  wireJson
} from "../device-fixtures";
import {
  createCtx,
  flush,
  GAME_01_SOURCES,
  manifestOf,
  stubFrames,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The D1 strip in happy-dom: the device row (no rate cell), the headline, the
// keys, a canvas click (the painter's hit tests mocked), the record panel and
// its empty state, More / Less, the REC cell, the tree card's device note.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../derive", async importOriginal => {
  const actual = await importOriginal<typeof import("../../derive")>();
  return { ...actual, deriveSnapshot: vi.fn(actual.deriveSnapshot) };
});

vi.mock("../../device/contract", async importOriginal => {
  const actual = await importOriginal<typeof import("../../device/contract")>();
  return { ...actual, spikeAt: vi.fn(() => -1), rowAt: vi.fn(() => -1) };
});

/** The device sources of an agent with perf and the recorder. */
const PERF_SOURCES = [
  "editor.perf.second",
  "editor.perf.window",
  "editor.perf.spikes",
  "editor.perf.spike",
  "editor.recorder"
];

let ctx: TestCtx;
let host: HTMLElement;
let sessions: SessionInfo[];

/**
 * The panel tools of a render.
 *
 * @param status - The link status.
 * @returns The tools.
 */
function toolsOf(status: LinkStatus): PanelTools<Readonly<Record<string, string>>> {
  return {
    run: {},
    status,
    channel: ctx.link.api,
    files: ctx.link.api.files,
    workspace: ctx.workspace.api
  };
}

/**
 * Renders the Render panel.
 */
function show(): void {
  act(() => {
    render(createRenderPanel(ctx).view({}, toolsOf({ kind: "live", frame: 4845 })), host);
  });
}

/**
 * The first element of a selector.
 *
 * @param selector - The selector.
 * @returns The element, or null.
 */
function q<T extends Element = HTMLElement>(selector: string): T | null {
  return host.querySelector<T>(selector);
}

/**
 * Clicks an element inside act.
 *
 * @param element - The element.
 */
function click(element: Element | null): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 10 }));
  });
}

/**
 * Attaches a session with perf, shows Render and delivers the demo values.
 *
 * @param session - The session.
 * @param sources - The manifest's sources.
 */
async function strip(
  session: SessionInfo,
  sources: readonly string[] = [...GAME_01_SOURCES, ...PERF_SOURCES]
): Promise<void> {
  sessions = [session];
  ctx.link.manifestValue = manifestOf(sources);
  startRenderView(ctx);
  createHandlers(ctx)["workspace:changed"]({ ws: "render" });
  show();
  act(() => {
    ctx.link.send("editor.perf.second", toWireValue(secondOf()));
    ctx.link.send("editor.perf.window", wireJson(windowWire()));
    ctx.link.send("editor.perf.spikes", toWireValue(spikesOf()));
    ctx.link.send("editor.recorder", toWireValue(recorderOf()));
  });
  await flush();
}

beforeEach(() => {
  ctx = createCtx();
  sessions = [];
  ctx.link.api.sessions = () => sessions;
  ctx.link.api.session = () => sessions[0]?.id;
  ctx.link.api.engine = () => COMPUTER_ENGINE;
  ctx.link.api.read = vi.fn(() => Promise.resolve(toWireValue(recordOf())));
  stubFrames();
  host = document.createElement("div");
  document.body.append(host);
  vi.mocked(spikeAt).mockReturnValue(-1);
  vi.mocked(rowAt).mockReturnValue(-1);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  stopRenderView(ctx);
  host.remove();
  vi.unstubAllGlobals();
});

describe("the device strip", () => {
  it("shows the model, the about line, backend, engine with STALE, build, link and REC — and no rate cell", async () => {
    await strip(deviceSession("s-1", DEVICE));

    expect(q("[data-render='device-strip']")).not.toBeNull();
    expect(q("[data-part='bar']")?.textContent).toBe("Devices1 connectedPerformance");
    expect(q("[data-part='model-name']")?.textContent).toBe("SM-A266B");
    expect(q("[data-part='about']")?.textContent).toBe("Android 15, WebView 131, 120 Hz, dpr 2.81");
    expect(q("[data-cell='backend']")?.textContent).toContain("webgpu");
    expect(q("[data-cell='engine']")?.textContent).toBe(
      "engine fingerprint0.14.12+9c41e0STALEcomputer has 0.14.13+1ab7f2"
    );
    expect(q("[data-cell='build']")?.textContent).toContain("debug, read-only");
    expect(q("[data-cell='link']")?.textContent).toContain("ADB127.0.0.1:47600");
    expect(q("[data-cell='log']")?.textContent).toBe("logREC 03:12");
    expect(q("[data-cell='rate']")).toBeNull();
  });

  it("the drawn / loop span holds the rate suffix", async () => {
    await strip(deviceSession("s-1", DEVICE));

    const fps = [...host.querySelectorAll("[data-part='headline'] > span")][1];
    expect(fps?.textContent).toBe("drawn / loop 54 / 60 @120 fps");
    expect(fps?.querySelector("[title]")?.getAttribute("title")).toBe(
      "120 fps, auto; display 120 Hz"
    );
  });

  it("the REC cell is absent for an agent without editor.recorder", async () => {
    await strip(
      deviceSession("s-1", DEVICE),
      [...GAME_01_SOURCES, ...PERF_SOURCES].filter(id => id !== "editor.recorder")
    );

    expect(q("[data-cell='log']")).toBeNull();
  });

  it("the canvas click on a flag opens that spike's record", async () => {
    await strip(deviceSession("s-1", DEVICE));
    vi.mocked(spikeAt).mockReturnValue(326);

    click(q("[data-part='canvas']"));
    await act(flush);

    expect(ctx.link.api.read).toHaveBeenCalledWith("editor.perf.spike", { frame: 4812 });
    expect(q("[data-part='record-id'] b")?.textContent).toBe("Frame 4812");
    expect(q("[data-part='word']")?.textContent).toBe("Upload");
  });

  it("a click on a plain bar moves the selection and keeps the panel", async () => {
    await strip(deviceSession("s-1", DEVICE));
    vi.mocked(rowAt).mockReturnValue(214);

    click(q("[data-part='canvas']"));

    expect(createRenderViewApi(ctx).device()?.selected).toBe(4700);
    expect(createRenderViewApi(ctx).device()?.counter).toBe("–/6");
    expect(ctx.link.api.read).not.toHaveBeenCalled();
    expect(q("[data-part='empty']")).not.toBeNull();
  });

  it("the next key opens a record; close shows the empty state", async () => {
    await strip(deviceSession("s-1", DEVICE));

    click(q("[data-part='nav'] [data-action='next-spike']"));
    await act(flush);
    expect(q("[data-part='record-id'] b")?.textContent).toBe("Frame 4572");

    click(q("[data-action='close-record']"));
    expect(q("[data-part='empty']")?.textContent).toBe(
      "No spike selectedClick a legend flag, a tall bar or the chevrons to see why that frame ran long."
    );
  });

  it("Less hides the secondary counters and More shows them again", async () => {
    await strip(deviceSession("s-1", DEVICE));
    const more = (): string => q("[data-part='more']")?.textContent ?? "";
    expect(more()).toContain("kept 4 pictures, 0 retakes");

    click(q("[data-action='more']"));
    expect(more()).toBe(
      "systems, filters, kept, redraws, views, heap, insets, backend, canvas, device"
    );
    expect(q("[data-action='more']")?.textContent).toBe("More");

    click(q("[data-action='more']"));
    expect(more()).toContain("passes max 3");
  });

  it("the keys are disabled without spikes", async () => {
    await strip(deviceSession("s-1", DEVICE));
    act(() => {
      ctx.link.send("editor.perf.window", wireJson(windowWire([])));
    });

    expect(q<HTMLButtonElement>("[data-part='nav'] [data-action='prev-spike']")?.disabled).toBe(
      true
    );
    expect(q<HTMLButtonElement>("[data-part='nav'] [data-action='next-spike']")?.disabled).toBe(
      true
    );
    expect(q("[data-part='nav'] [data-part='counter']")?.textContent).toBe("0/0");
  });

  it("the strip offers no kept-pictures switch", async () => {
    await strip(deviceSession("s-1", DEVICE));

    const labels = [...host.querySelectorAll("[data-render='device-strip'] button")].map(
      button => button.textContent ?? ""
    );
    expect(labels.some(label => /kept/i.test(label))).toBe(false);
    expect(host.querySelector("[data-render='device-strip'] input")).toBeNull();
  });
});

describe("the render tree card beside the strip", () => {
  it("shows the device note on a device session", async () => {
    await strip(deviceSession("s-1", DEVICE));

    expect(q("[data-device-note]")?.textContent).toBe(
      "The render tree is not read from a device: reading it costs the phone frames."
    );
  });

  it("a browser session shows the strip above today's render tree, with no device note", async () => {
    await strip(deviceSession("s-1"));

    expect(q("[data-render='device-strip'] [data-cell='link']")?.textContent).toContain("BROWSER");
    expect(q("[data-part='bar']")?.textContent).toBe("Browser1 connectedPerformance");
    expect(q("[data-device-note]")).toBeNull();
    const shown = q("[data-render='device-strip']");
    const tiles = q("[data-render='tiles']");
    expect(shown?.nextElementSibling).toBe(tiles);
  });

  it("no strip for a session whose manifest lists no editor.perf.second", async () => {
    await strip(deviceSession("s-1"), GAME_01_SOURCES);

    expect(q("[data-render='device-strip']")).toBeNull();
  });
});

describe("the strip's own re-render (review W1, W4)", () => {
  it("an off-shape value never throws and the Render workspace still renders", async () => {
    await strip(deviceSession("s-1", DEVICE));
    const second = toWireValue(secondOf()) as { [key: string]: object };

    act(() => {
      ctx.link.send("editor.perf.second", {
        ...second,
        display: { ...second.display, canvas: null }
      });
      ctx.link.send("editor.perf.spikes", [
        { ...(toWireValue(spikesOf()[0]) as object), cause: "boom" }
      ]);
    });
    vi.mocked(ctx.link.api.read).mockResolvedValue({
      ...(toWireValue(recordOf()) as object),
      detail: {}
    });
    click(q("[data-part='nav'] [data-action='next-spike']"));
    await act(flush);

    expect(q("[data-render='tiles']")).not.toBeNull();
    expect(q("[data-part='model-name']")?.textContent).toBe("SM-A266B");
    expect(q("[data-part='more']")?.textContent).toContain("canvas 1080 \u00D7 2340");
    expect(ctx.state.device.record).toMatchObject({ kind: "failed" });
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "editor.perf.second"
    });
  });

  it("a device value re-renders the strip, not the workspace snapshot", async () => {
    await strip(deviceSession("s-1", DEVICE));
    vi.mocked(deriveSnapshot).mockClear();

    act(() => {
      ctx.link.send("editor.perf.second", toWireValue(secondOf({ fps: { loop: 60, drawn: 41 } })));
    });

    expect(q("[data-part='headline']")?.textContent).toContain("drawn / loop 41 / 60");
    expect(deriveSnapshot).not.toHaveBeenCalled();
  });
});

/**
 * The CSS colour of a painter colour in both themes: light first, dark second.
 *
 * @param light - The light theme's colour.
 * @param dark - The dark theme's colour.
 * @returns The `light-dark()` value.
 */
function themed(light: string, dark: string): string {
  return `light-dark(${light}, ${dark})`;
}

/**
 * The inline `--c` of the first element of a selector.
 *
 * @param selector - The selector.
 * @returns The value, or "" without one.
 */
function colourOf(selector: string): string {
  return q(selector)?.style.getPropertyValue("--c").trim() ?? "";
}

describe("the strip in the editor's theme (spec 09 Delta 2026-10-15)", () => {
  it("the legend's cause keys and swatches take the painter's light and dark colours, so they follow the theme", async () => {
    await strip(deviceSession("s-1", DEVICE));

    const legends = [...host.querySelectorAll<HTMLElement>("[data-part='legend'] [data-an]")];
    expect(legends).toHaveLength(CAUSE_RANK.length);
    for (const cause of CAUSE_RANK) {
      const legend = legends.find(
        node => node.firstChild?.textContent === CAUSE_STYLE[cause].legend
      );
      expect(legend?.style.getPropertyValue("--c").trim(), cause).toBe(
        themed(causeHue("light", cause), causeHue("dark", cause))
      );
    }
    for (const key of ["js", "gpu", "idle"] as const) {
      expect(colourOf(`[data-swatch='${key}']`), key).toBe(
        themed(GRAPH_PALETTES.light[key], GRAPH_PALETTES.dark[key])
      );
    }
    expect(colourOf("[data-part='legend'] [data-part='budget']")).toBe(
      themed(GRAPH_PALETTES.light.magenta, GRAPH_PALETTES.dark.magenta)
    );
    expect(q("[data-render='device-strip']")?.getAttribute("style")).toBeNull();
  });

  it("the record's lead keys, why rule, budget and GPU bars follow the theme too", async () => {
    await strip(deviceSession("s-1", DEVICE));
    vi.mocked(spikeAt).mockReturnValue(326);

    click(q("[data-part='canvas']"));
    await act(flush);

    expect(colourOf("[data-part='lead'] [data-an]")).toBe(
      themed(causeHue("light", "upload"), causeHue("dark", "upload"))
    );
    expect(colourOf("[data-part='why']")).toBe(
      themed(causeHue("light", "upload"), causeHue("dark", "upload"))
    );
    expect(colourOf("[data-part='numbers'] [data-part='budget']")).toBe(
      themed(GRAPH_PALETTES.light.magenta, GRAPH_PALETTES.dark.magenta)
    );
    expect(colourOf("[data-part='bars'][data-kind='gpu']")).toBe(
      themed(GRAPH_PALETTES.light.gpu, GRAPH_PALETTES.dark.gpu)
    );
  });
});
