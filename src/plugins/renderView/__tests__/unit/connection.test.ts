/* eslint-disable sonarjs/no-hardcoded-ip -- test data: the LAN address of a phone */
/* eslint-disable unicorn/no-null -- null is "none" in activeSource's and perf's values */
import { describe, expect, it } from "vitest";
import {
  actionsNote,
  browserOf,
  factsOf,
  healthText,
  linkWords,
  osOf,
  pausedChip,
  sourceView,
  staleTag,
  statusTag,
  subLine
} from "../../derive/connection";
import type { ActiveSource, PerfSecond, SourceLabel } from "../../source/contract";
import { DEVICE, secondOf } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/connection.ts (spec 09 § M7): the connection bar's words.
// ─────────────────────────────────────────────────────────────────────────────

const PHONE: ActiveSource = { kind: "device", session: "s-9", device: DEVICE };
const LOCAL: ActiveSource = { kind: "local", session: "s-1" };
const NOTHING: ActiveSource = { kind: "local", session: null };

const A26: SourceLabel = {
  name: "Galaxy A26",
  model: "SM-A266B",
  kind: "device",
  link: { kind: "wire", transport: "adb", address: "127.0.0.1" }
};
const LAN: SourceLabel = {
  ...A26,
  link: { kind: "network", transport: "lan", address: "192.168.1.23" }
};
const PREVIEW: SourceLabel = {
  name: "Local preview",
  model: null,
  kind: "local",
  link: { kind: "local", transport: "frame", address: null }
};

/** The demo phone's display. */
const DISPLAY = {
  dpr: 2.8125,
  resolution: 1,
  maxResolution: 1,
  canvas: { w: 1080, h: 2340 },
  css: { w: 384, h: 832 },
  safeArea: { t: 32, r: 0, b: 24, l: 0 },
  backend: "webgpu" as const,
  orientation: "portrait" as const
};

/** A desktop page's device facts. */
const DESKTOP = {
  userAgent: "",
  model: null,
  modelFrom: "ua" as const,
  webview: null,
  cores: 10,
  memoryGb: 32
};

/** A desktop Chrome 153 second of the local preview. */
const CHROME: PerfSecond = secondOf({
  device: {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    model: null,
    modelFrom: null,
    webview: null,
    cores: 10,
    memoryGb: 32
  }
} as Partial<PerfSecond>);

describe("source and status", () => {
  it("a device source shows Connected, its model and 'by wire, USB'; a wireless adb serial reads 'by wire, Wi-Fi debugging'; lan 'on the network'", () => {
    // Bug: a phone over Wi-Fi debugging described as plugged in by USB.
    expect(statusTag(PHONE, secondOf())).toEqual({ text: "Connected", tone: "ok" });
    expect(subLine(PHONE, A26, secondOf())).toBe("SM-A266B");
    expect(linkWords(PHONE, A26, false)).toBe("by wire, USB");
    expect(linkWords(PHONE, A26, true)).toBe("by wire, Wi-Fi debugging");
    expect(linkWords(PHONE, LAN, false)).toBe("on the network");
    expect(subLine(PHONE, LAN, secondOf())).toBe("SM-A266B, 192.168.1.23");
  });

  it("the local preview reads 'Chrome 153 in this editor window'", () => {
    // Bug: the local preview named by the phone's WebView after a switch back.
    expect(subLine(LOCAL, PREVIEW, CHROME)).toBe("Chrome 153 in this editor window");
    expect(browserOf(secondOf().device)).toBe("WebView 131");
    expect(statusTag(LOCAL, CHROME)).toEqual({ text: "Running", tone: "plain" });
    expect(linkWords(NOTHING, PREVIEW, false)).toBe("Nothing is running");
  });

  it("a device without a second reads 'Connected, waiting'; a source's state follows the second and the manifest", () => {
    // Bug: "Connected" (and zeros) shown before the phone sent a frame.
    expect(statusTag(PHONE, undefined)).toEqual({ text: "Connected, waiting", tone: "warn" });
    expect(sourceView(PHONE, A26, undefined, true)?.state).toBe("waiting");
    expect(sourceView(PHONE, A26, secondOf(), false)?.state).toBe("no-monitor");
    expect(sourceView(NOTHING, PREVIEW, undefined, true)?.state).toBe("not-started");
    expect(sourceView(PHONE, A26, secondOf(), true)).toEqual({
      session: "s-9",
      kind: "device",
      name: "Galaxy A26",
      link: "wire",
      state: "live"
    });
    expect(sourceView(undefined, A26, undefined, true)).toBeUndefined();
  });

  it("the paused chip follows preview(): paused-by-source, held, unpausable with its reason", () => {
    // Bug: "paused" shown when the pause was refused (the local preview still runs).
    expect(pausedChip(PHONE, { state: "paused-by-source" }, "Galaxy A26")).toMatchObject({
      bold: "Local preview paused",
      rest: "while Galaxy A26 is connected"
    });
    expect(pausedChip(PHONE, { state: "held" }, "Galaxy A26")?.bold).toBe("Local preview held");
    expect(
      pausedChip(PHONE, { state: "unpausable", reason: "no game.pause" }, "Galaxy A26")
    ).toEqual({
      bold: "Could not pause the local preview:",
      rest: "no game.pause",
      tone: "warn",
      busy: false
    });
    expect(pausedChip(PHONE, { state: "pausing" }, "Galaxy A26")?.busy).toBe(true);
    expect(pausedChip(LOCAL, { state: "paused-by-source" }, "Local preview")).toBeUndefined();
  });

  it("the health line reads the newest of 48 samples and '—' when it is NaN", () => {
    // Bug: the oldest latency shown, or "NaN ms".
    const samples = new Float32Array(48).fill(30);
    samples[17] = 9.4;
    expect(healthText({ kind: "wire", latencyMs: 9, samples, head: 17 })).toBe("9 ms");
    samples[17] = Number.NaN;
    expect(healthText({ kind: "wire", latencyMs: null, samples, head: 17 })).toBe("—");
  });

  it("STALE shows the 'engine differs' tag only when both ids are known and differ", () => {
    // Bug: "engine differs" on every page whose computer fingerprint is not known yet.
    expect(staleTag("0.15.0+9c41e0", "0.15.1+1ab7f2")).toMatchObject({ text: "engine differs" });
    expect(staleTag("0.15.0+9c41e0", "0.15.0+9c41e0")).toBeUndefined();
    expect(staleTag(null, "0.15.1+1ab7f2")).toBeUndefined();
    expect(staleTag("0.15.0+9c41e0", undefined)).toBeUndefined();
  });
});

describe("facts", () => {
  it("a device lists OS, Browser, Build, Display, Rate now and dpr; on the network the Address instead of dpr", () => {
    // Bug: the local preview's facts left in the bar of a device source.
    const second = secondOf({
      display: { ...DISPLAY, hz: 120 }
    } as Partial<PerfSecond>);
    const wire = factsOf({ source: PHONE, label: A26, second, computerEngine: undefined });
    expect(wire.map(fact => [fact.label, fact.value])).toEqual([
      ["OS", "Android 15"],
      ["Browser", "WebView 131"],
      ["Build", "0.14.12"],
      ["Display", "120 Hz"],
      ["Rate now", "60 fps"],
      ["dpr", "2.8"]
    ]);
    const lan = factsOf({ source: PHONE, label: LAN, second, computerEngine: undefined });
    expect(lan.at(-1)).toEqual({ label: "Address", value: "192.168.1.23" });
  });

  it("nothing running is one cell; the local preview has no OS and no Build", () => {
    // Bug: dashes for a phone's facts shown on a page with nothing running.
    expect(
      factsOf({ source: NOTHING, label: PREVIEW, second: undefined, computerEngine: undefined })
    ).toEqual([{ label: "Source", value: "No game running" }]);
    const local = factsOf({
      source: LOCAL,
      label: PREVIEW,
      second: undefined,
      computerEngine: undefined
    });
    expect(local.map(fact => [fact.label, fact.value])).toEqual([
      ["Browser", "—"],
      ["Display", "—"],
      ["Rate now", "—"],
      ["dpr", "—"]
    ]);
    expect(actionsNote(NOTHING)).toBe("Start the preview or");
    expect(actionsNote(LOCAL)).toBe("No device connected");
    expect(actionsNote(PHONE)).toBeUndefined();
  });
});

/**
 * A desktop page's device facts with a user agent.
 *
 * @param userAgent - The user agent.
 * @returns The facts.
 */
function device(userAgent: string) {
  return { ...DESKTOP, userAgent };
}

describe("browser and OS words", () => {
  it("name the browser and the OS from the page's user agent", () => {
    // Bug: every page called "Chrome", an iPhone shell called Safari.
    expect(
      browserOf(
        device(
          "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/150.0 Safari/537.36 Edg/150.0"
        )
      )
    ).toBe("Edge 150");
    expect(
      browserOf(device("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"))
    ).toBe("Firefox 140");
    expect(
      browserOf(
        device(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15"
        )
      )
    ).toBe("Safari 18");
    expect(
      browserOf(
        device(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
        )
      )
    ).toBe("WKWebView");
    expect(browserOf(device("curl/8.0"))).toBeUndefined();
    expect(browserOf(undefined)).toBeUndefined();
    expect(osOf(device("Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)"))).toBe("iOS 17.2");
    expect(osOf(device("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)"))).toBe("macOS");
    expect(osOf(device("Mozilla/5.0 (Windows NT 10.0; Win64)"))).toBe("Windows");
    expect(osOf(device("Mozilla/5.0 (X11; Linux x86_64)"))).toBe("Linux");
    expect(osOf(device("curl/8.0"))).toBeUndefined();
  });

  it("reads another page and a page's dashes; a debug build is tagged", () => {
    // Bug: a debug build shown without its tag (control commands look broken).
    expect(statusTag({ kind: "page", session: "s-3" }, undefined)).toEqual({
      text: "Another page",
      tone: "plain"
    });
    const debug = factsOf({
      source: PHONE,
      label: A26,
      second: secondOf({ build: "debug-20261016T090000Z", engine: "0.15.0+9c41e0" }),
      computerEngine: "0.15.1+1ab7f2"
    });
    expect(debug.find(fact => fact.label === "Build")?.tags?.map(tag => tag.text)).toEqual([
      "debug",
      "engine differs"
    ]);
    expect(linkWords(LOCAL, PREVIEW, false)).toBe("In this editor window");
    expect(subLine(LOCAL, PREVIEW, undefined)).toBe("In this editor window");
    expect(pausedChip(PHONE, { state: "resuming" }, "Galaxy A26")?.bold).toBe("Resuming…");
    expect(pausedChip(PHONE, { state: "running" }, "Galaxy A26")).toBeUndefined();
  });
});
