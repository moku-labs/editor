/* eslint-disable unicorn/no-null -- null is the engine's "not reported" */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { describe, expect, it } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { readWireWindow } from "../../device/contract";
import {
  aboutLine,
  buildProfile,
  headline,
  isStale,
  linkCell,
  moreText,
  rateSuffix,
  recCell,
  seenSeconds,
  seenText,
  stripView
} from "../../device/derive";
import { createDeviceStripState } from "../../device/state";
import type { DeviceStripState, StripLine } from "../../device/types";
import {
  COMPUTER_ENGINE,
  DEVICE,
  recorderOf,
  sampleOf,
  secondOf,
  windowWire,
  wireJson
} from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// device/derive.ts: the strip view and the texts of the device row, the
// headline and More — pure formatting of perf's values.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE: LinkStatus = { kind: "live", frame: 4845 };

/**
 * The text of a line.
 *
 * @param line - The runs.
 * @returns Their text.
 */
function textOf(line: StripLine): string {
  return line.map(run => run.text).join("");
}

/**
 * A strip state of a session with the demo values.
 *
 * @param kind - A phone's device session, or a browser session.
 * @returns The state.
 */
function stripOf(kind: "device" | "browser" = "device"): DeviceStripState {
  const strip = createDeviceStripState();
  strip.session = { id: "s-1", device: kind === "device" ? DEVICE : undefined };
  strip.perf = "listed";
  strip.second = secondOf();
  strip.secondAt = 10_000;
  readWireWindow(wireJson(windowWire()), strip.window);
  return strip;
}

describe("the engine fingerprint", () => {
  it("STALE shows when the phone runs another engine than the computer", () => {
    expect(isStale("0.14.12+9c41e0", COMPUTER_ENGINE)).toBe(true);
    expect(stripView(stripOf(), 10_000, COMPUTER_ENGINE)?.engine).toEqual({
      device: "0.14.12+9c41e0",
      computer: COMPUTER_ENGINE,
      stale: true
    });
  });

  it("no STALE when either id is unknown or both are equal", () => {
    expect(isStale(undefined, COMPUTER_ENGINE)).toBe(false);
    expect(isStale("0.14.12+9c41e0", undefined)).toBe(false);
    expect(isStale(COMPUTER_ENGINE, COMPUTER_ENGINE)).toBe(false);
  });
});

describe("the build", () => {
  it("a debug-full build reads 'debug, full', not 'debug, read-only'", () => {
    expect(buildProfile("debug-full-20261014T160000Z")).toBe("debug, full");
    expect(buildProfile("debug-20261014T160000Z")).toBe("debug, read-only");
    expect(buildProfile("dev")).toBe("dev");
    expect(buildProfile(null)).toBeUndefined();
  });
});

describe("the about line", () => {
  it("joins OS, WebView, Hz and dpr", () => {
    expect(aboutLine(secondOf())).toBe("Android 15, WebView 131, 60 Hz, dpr 2.81");
  });

  it("the about line drops unknown parts", () => {
    const second = secondOf({ display: null, sample: null });
    const device = second.device ?? undefined;
    expect(
      aboutLine({ ...second, device: device === undefined ? null : { ...device, webview: null } })
    ).toBe("Android 15");
    expect(aboutLine(undefined)).toBe("");
  });
});

describe("seen", () => {
  it("seen 0 s reads 'seen now', 1.9 s reads 'seen 1 s ago'", () => {
    expect(seenText(seenSeconds(10_000, 10_000))).toBe("seen now");
    expect(seenText(seenSeconds(10_000, 11_900))).toBe("seen 1 s ago");
    expect(seenSeconds(undefined, 11_900)).toBeUndefined();
  });
});

describe("the headline", () => {
  it("reads the demo second: spikes, drawn / loop with the rate, p90, GPU, passes, draws, texture", () => {
    const strip = stripOf();
    const lines = headline(strip.second, strip.window, false).map(line => textOf(line));

    expect(lines).toEqual([
      "Last 6 s from the phone, 6 spikes",
      "drawn / loop 54 / 60 @120 fps",
      "p90 frame 18.2 ms",
      "GPU 6.0 ms avg",
      "passes 6",
      "draws 212",
      "texture 96 / 32 / 1 MB art / targets / kept"
    ]);
  });

  it("the headline reads 'drawn / loop 54 / 60 @120 fps' with the suffix inside the drawn / loop span", () => {
    const strip = stripOf();
    const fps = headline(strip.second, strip.window, false)[1] ?? [];

    expect(fps.map(run => run.text)).toEqual(["drawn / loop ", "54 / 60", " ", "@120", " fps"]);
    expect(fps[3]).toEqual({ text: "@120", tone: "value", title: "120 fps, auto; display 120 Hz" });
  });

  it("the suffix @60 is amber with the fall-back title after a switch from 120", () => {
    const rate = { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 } as const;

    expect(rateSuffix(rate)).toEqual({
      text: "@60",
      tone: "warn",
      title: "60 fps, auto, fell back (missed); display 120 Hz"
    });
  });

  it("a fixed 60 on a 60 Hz display is not amber", () => {
    const rate = { fps: 60, mode: "fixed", reason: "start", displayHz: 60, switches: 0 } as const;

    expect(rateSuffix(rate)?.tone).toBe("value");
    expect(rateSuffix(rate)?.title).toBe("60 fps, fixed; display 60 Hz");
  });

  it("an unknown rate shows no suffix", () => {
    const strip = stripOf();
    const second = secondOf({
      rate: { fps: null, mode: null, reason: null, displayHz: null, switches: 0 }
    });

    expect(rateSuffix(second.rate)).toBeUndefined();
    expect(textOf(headline(second, strip.window, false)[1] ?? [])).toBe("drawn / loop 54 / 60 fps");
  });

  it("p90 over the budget is amber, at the budget it is not", () => {
    const strip = stripOf();
    const over = secondOf({ budgetMs: 18.1 });
    const at = secondOf({ budgetMs: 18.2 });

    expect(headline(over, strip.window, false)[2]?.[1]?.tone).toBe("warn");
    expect(headline(at, strip.window, false)[2]?.[1]?.tone).toBe("value");
  });

  it("a phone without a GPU timer reads 'GPU — no timer' and draws '—' on WebGL", () => {
    const strip = createDeviceStripState();
    readWireWindow(wireJson(windowWire(undefined, { gpuTimer: false })), strip.window);
    const second = secondOf({ sample: sampleOf({ draws: null }) });
    const lines = headline(second, strip.window, false).map(line => textOf(line));

    expect(lines[3]).toBe("GPU — no timer");
    expect(lines[5]).toBe("draws —");
  });

  it("texture kept reads render.kept.mb 1.4 as 1, not the sample's 0; with render: null the sample's kept", () => {
    const strip = stripOf();
    const fromRender = headline(secondOf(), strip.window, false).map(line => textOf(line))[6];
    const fromSample = headline(
      secondOf({
        render: null,
        sample: sampleOf({ textures: { count: 40, mb: 130, art: 96, targets: 32, kept: 3 } })
      }),
      strip.window,
      false
    ).map(line => textOf(line))[6];

    expect(fromRender).toBe("texture 96 / 32 / 1 MB art / targets / kept");
    expect(fromSample).toBe("texture 96 / 32 / 3 MB art / targets / kept");
  });

  it("a browser session's headline says 'from the browser'", () => {
    const strip = stripOf("browser");

    expect(textOf(headline(strip.second, strip.window, true)[0] ?? [])).toBe(
      "Last 6 s from the browser, 6 spikes"
    );
  });
});

describe("More", () => {
  it("lists kept pictures and retakes, passes max, redraws · rebuilds and the screen facts", () => {
    const text = textOf(moreText(secondOf(), "SM-A266B", true));

    expect(text).toBe(
      "systems: frost-apply 2.1 · ripple 1.4 · glass 0.9 ms · filters 4 · kept 4 pictures, 0 retakes · passes max 3 · rate switches 1 · redraws 0 · rebuilds 0 · views 1 384 · heap 151 MB · insets t32 b24 l0 r0 · backend webgpu · canvas 1080 × 2340, scale 1.0 · device SM-A266B, 60 Hz, dpr 2.81"
    );
  });

  it("a production build's null redraws reads 'redraws — dev builds only'; null kept reads 'kept —'", () => {
    const second = secondOf({
      render: { passesMax: null, kept: null, redraws: null, rebuilds: null }
    });
    const text = textOf(moreText(second, "SM-A266B", true));

    expect(text).toContain("kept — · passes max —");
    expect(text).toContain("redraws — dev builds only");
    expect(text).not.toContain("rebuilds");
  });

  it("closed, it names what it holds", () => {
    expect(textOf(moreText(secondOf(), "SM-A266B", false))).toBe(
      "systems, filters, kept, redraws, views, heap, insets, backend, canvas, device"
    );
  });
});

describe("the device row cells", () => {
  it("the REC clock shows the recorder's sinceMs", () => {
    const strip = stripOf();
    strip.recorder = recorderOf({ sinceMs: 192_000 });
    const view = stripView(strip, 999_999_999, COMPUTER_ENGINE);

    expect(view?.rec).toEqual({ state: "recording", clock: "03:12" });
    expect(recCell(view?.rec)).toEqual({ text: "REC 03:12", tone: "red", lit: true });
    expect(recCell({ state: "idle", clock: undefined })).toEqual({
      text: "STOPPED",
      tone: "ink2",
      lit: false
    });
    expect(recCell(undefined)).toBeUndefined();
  });

  it("the adb link cell reads 127.0.0.1:47600 from address and port", () => {
    const view = stripView(stripOf(), 11_000, COMPUTER_ENGINE);
    if (view === undefined) throw new Error("no view");

    expect(linkCell(view.link, view.seenSeconds, LIVE)).toEqual({
      legend: "ADB",
      tone: "green",
      text: "127.0.0.1:47600, seen 1 s ago"
    });
  });

  it("the LAN link cell reads 192.168.1.23 → :47600", () => {
    const link = { kind: "lan", address: "192.168.1.23", port: 47_600 } as const;

    expect(linkCell(link, 0, LIVE).text).toBe("192.168.1.23 → :47600, seen now");
  });

  it("a silent session turns the legend amber and reads 'silent N s'", () => {
    const silent: LinkStatus = { kind: "silent", since: 1, lastFrame: 4845 };

    expect(linkCell({ kind: "adb", address: "127.0.0.1", port: 47_600 }, 7, silent)).toEqual({
      legend: "ADB",
      tone: "amber",
      text: "127.0.0.1:47600, silent 7 s"
    });
  });

  it("a browser session's link cell reads BROWSER and 'seen now', with no address and no port", () => {
    const view = stripView(stripOf("browser"), 10_000, COMPUTER_ENGINE);
    if (view === undefined) throw new Error("no view");

    expect(view.link).toEqual({ kind: "browser" });
    expect(linkCell(view.link, view.seenSeconds, LIVE)).toEqual({
      legend: "BROWSER",
      tone: "ink2",
      text: "seen now"
    });
  });
});

describe("stripView", () => {
  it("is undefined without a session and names what perf can measure", () => {
    const strip = stripOf();

    expect(stripView(createDeviceStripState(), 0, undefined)).toBeUndefined();
    expect(stripView(strip, 10_000, undefined)?.perf).toBe("live");
    strip.second = secondOf({ state: "off" });
    expect(stripView(strip, 10_000, undefined)?.perf).toBe("no-monitor");
    strip.second = undefined;
    expect(stripView(strip, 10_000, undefined)?.perf).toBe("waiting");
  });

  it("falls back to the session's device for the model, the engine and the build", () => {
    const strip = stripOf();
    strip.second = undefined;
    const view = stripView(strip, 10_000, COMPUTER_ENGINE);

    expect(view?.model).toBe("SM-A266B");
    expect(view?.build).toEqual({ id: "debug-20261014T160000Z", profile: "debug, read-only" });
    expect(view?.engine.device).toBe("0.14.12+9c41e0");
  });
});
