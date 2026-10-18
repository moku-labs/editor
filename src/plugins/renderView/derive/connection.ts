/**
 * @file renderView derive — the connection bar's words (spec 09 § M7): the source's state, status
 * tag and sub line, the browser and OS read from the source's own second, the link words, the health
 * line's latency, the facts row (with the STALE "engine differs" tag), the paused chip and the note
 * beside the actions. Every string of the bar is here. Pure.
 */
import type {
  ActiveSource,
  LocalPreview,
  PerfHeaderLine,
  PerfSecond,
  SourceHealth,
  SourceLabel
} from "../source/contract";
import type { MissionView } from "../types";
import { rateNow } from "./rate";
import type { Tag, Tone } from "./words";
import { DASH, oneDecimal } from "./words";

/** The header's device facts. */
type HeaderDevice = PerfHeaderLine["device"];

/**
 * A fact cell: a label over a value, with an optional em and tag.
 *
 * @example
 * ```ts
 * const fact: Fact = { label: "Rate now", value: "60 fps", em: { text: "adaptive, dropped from 120: missed frames", tone: "warn" } };
 * ```
 */
export type Fact = {
  readonly label: string;
  readonly value: string;
  readonly em?: { readonly text: string; readonly tone: "calm" | "warn" };
  readonly tags?: readonly Tag[];
};

/**
 * The source part of MissionView: session, kind, name, link, and its state (not started, no monitor,
 * waiting for the first second, live).
 *
 * @param source - activeSource.current().
 * @param label - activeSource.label().
 * @param second - The source's newest second.
 * @param monitored - The manifest lists `editor.perf.second` as available.
 * @returns The source view; undefined without a source.
 * @example
 * ```ts
 * sourceView(phone, label, second, true); // { session: "s-9", kind: "device", name: "Galaxy A26", link: "wire", state: "live" }
 * ```
 */
export function sourceView(
  source: ActiveSource | undefined,
  label: SourceLabel,
  second: PerfSecond | undefined,
  monitored: boolean
): MissionView["source"] | undefined {
  if (source === undefined) return undefined;
  let state: MissionView["source"]["state"] = "live";
  if (source.kind === "local" && source.session === null) state = "not-started";
  else if (!monitored) state = "no-monitor";
  else if (second === undefined || second.state === "waiting") state = "waiting";
  return {
    session: source.session,
    kind: source.kind,
    name: label.name,
    link: label.link.kind,
    state
  };
}

/**
 * The status tag beside the source's name.
 *
 * @param source - activeSource.current().
 * @param second - The source's newest second.
 * @returns "Connected" (ok), "Connected, waiting" (warn), "Running", "Not started" (muted), "Another
 *   page".
 * @example
 * ```ts
 * statusTag(phone, undefined); // { text: "Connected, waiting", tone: "warn" }
 * ```
 */
export function statusTag(source: ActiveSource, second: PerfSecond | undefined): Tag {
  if (source.kind === "device") {
    return second === undefined
      ? { text: "Connected, waiting", tone: "warn" }
      : { text: "Connected", tone: "ok" };
  }
  if (source.kind === "page") return { text: "Another page", tone: "plain" };
  return source.session === null
    ? { text: "Not started", tone: "muted" }
    : { text: "Running", tone: "plain" };
}

/**
 * The page's browser in words, from the header's user agent: "WebView 140" on an Android WebView,
 * "WKWebView" in an iOS shell, "Chrome 153", "Safari 18", "Firefox 140".
 *
 * @param device - The header's device facts.
 * @returns The words; undefined when unknown.
 * @example
 * ```ts
 * browserOf(second.device); // "Chrome 153"
 * ```
 */
export function browserOf(device: HeaderDevice | null | undefined): string | undefined {
  if (device === null || device === undefined) return undefined;
  if (device.webview !== null) return `WebView ${device.webview}`;
  const agent = device.userAgent;
  if (/iPhone|iPad|iPod/u.test(agent) && !agent.includes("Safari/")) return "WKWebView";
  const edge = /Edg\/(\d+)/u.exec(agent);
  if (edge !== null) return `Edge ${edge[1]}`;
  const chrome = /(?:Chrome|CriOS)\/(\d+)/u.exec(agent);
  if (chrome !== null) return `Chrome ${chrome[1]}`;
  const firefox = /Firefox\/(\d+)/u.exec(agent);
  if (firefox !== null) return `Firefox ${firefox[1]}`;
  if (!agent.includes("Safari/")) return undefined;
  const safari = /Version\/(\d+)/u.exec(agent);
  return safari === null ? undefined : `Safari ${safari[1]}`;
}

/**
 * The page's OS in words, from the header's user agent.
 *
 * @param device - The header's device facts.
 * @returns "Android 15", "iOS 17.2", "macOS", "Windows", "Linux"; undefined when unknown.
 * @example
 * ```ts
 * osOf(second.device); // "Android 15"
 * ```
 */
export function osOf(device: HeaderDevice | null | undefined): string | undefined {
  const agent = device?.userAgent ?? "";
  const android = /Android (\d+(?:\.\d+)?)/u.exec(agent);
  if (android !== null) return `Android ${android[1]}`;
  const ios = /OS (\d+)_(\d+)/u.exec(agent);
  if (ios !== null && /iPhone|iPad|iPod/u.test(agent)) return `iOS ${ios[1]}.${ios[2]}`;
  if (agent.includes("Mac OS X")) return "macOS";
  if (agent.includes("Windows")) return "Windows";
  return agent.includes("Linux") ? "Linux" : undefined;
}

/**
 * The connection bar's sub line under the name: a device's model (on the network with its address),
 * the local preview's browser "in this editor window".
 *
 * @param source - activeSource.current().
 * @param label - activeSource.label().
 * @param second - The source's newest second.
 * @returns The words.
 * @example
 * ```ts
 * subLine(local, label, second); // "Chrome 153 in this editor window"
 * ```
 */
export function subLine(
  source: ActiveSource,
  label: SourceLabel,
  second: PerfSecond | undefined
): string {
  if (source.kind === "device") {
    const model = label.model ?? label.name;
    return label.link.kind === "network" && label.link.address !== null
      ? `${model}, ${label.link.address}`
      : model;
  }
  const browser = browserOf(second?.device);
  return browser === undefined ? "In this editor window" : `${browser} in this editor window`;
}

/**
 * The health line's transport words.
 *
 * @param source - activeSource.current().
 * @param label - activeSource.label().
 * @param wireless - The phone's adb serial is a wireless one (directory().wire's `transport`).
 * @returns "by wire, USB", "by wire, Wi-Fi debugging", "on the network", "In this editor window",
 *   "Nothing is running".
 * @example
 * ```ts
 * linkWords(phone, label, true); // "by wire, Wi-Fi debugging"
 * ```
 */
export function linkWords(source: ActiveSource, label: SourceLabel, wireless: boolean): string {
  if (source.kind === "local" && source.session === null) return "Nothing is running";
  if (label.link.transport === "adb") return wireless ? "by wire, Wi-Fi debugging" : "by wire, USB";
  if (label.link.transport === "lan") return "on the network";
  return "In this editor window";
}

/**
 * The health line's latency: the newest of the 48 samples in whole ms, "—" when it is NaN.
 *
 * @param health - activeSource.health().
 * @returns "9 ms" or "—".
 * @example
 * ```ts
 * healthText(app.activeSource.health()); // "9 ms"
 * ```
 */
export function healthText(health: SourceHealth): string {
  const newest = health.samples[health.head] ?? Number.NaN;
  return Number.isNaN(newest) ? DASH : `${Math.round(newest)} ms`;
}

/**
 * The STALE tag of the Build fact: "engine differs" only when both fingerprints are known and
 * differ.
 *
 * @param phone - The source's engine fingerprint (its second's `engine`).
 * @param computer - The computer's (link.engine()).
 * @returns The tag; undefined when they match or one is not known.
 * @example
 * ```ts
 * staleTag("0.15.0+9c41e0", "0.15.1+1ab7f2"); // { text: "engine differs", tone: "warn", title: "Phone runs 0.15.0+9c41e0, computer has 0.15.1+1ab7f2" }
 * ```
 */
export function staleTag(
  phone: string | null | undefined,
  computer: string | undefined
): Tag | undefined {
  if (phone === null || phone === undefined || computer === undefined || phone === computer) {
    return undefined;
  }
  return {
    text: "engine differs",
    tone: "warn",
    title: `Phone runs ${phone}, computer has ${computer}`
  };
}

/**
 * A dpr with one decimal, ".0" dropped.
 *
 * @param dpr - devicePixelRatio.
 * @returns "2.8", "2".
 */
function dprText(dpr: number | undefined): string {
  return dpr === undefined ? DASH : oneDecimal(dpr);
}

/**
 * The Build fact: the engine's version, a "debug" tag for a debug build and the STALE tag.
 *
 * @param second - The source's newest second.
 * @param computerEngine - link.engine().
 * @returns The fact.
 */
function buildFact(second: PerfSecond | undefined, computerEngine: string | undefined): Fact {
  const engine = second?.engine ?? undefined;
  const tags: Tag[] = [];
  if (second?.build?.startsWith("debug") === true) tags.push({ text: "debug", tone: "acc" });
  const stale = staleTag(engine, computerEngine);
  if (stale !== undefined) tags.push(stale);
  return { label: "Build", value: engine?.split("+")[0] ?? DASH, tags };
}

/**
 * The Rate now fact.
 *
 * @param second - The source's newest second.
 * @returns The fact.
 */
function rateFact(second: PerfSecond | undefined): Fact {
  const now = rateNow(second);
  if (now === undefined) return { label: "Rate now", value: DASH };
  return { label: "Rate now", value: now.text, em: { text: now.em, tone: now.tone } };
}

/**
 * The facts row (spec 09 § M7): a device's OS, Browser, Build, Display, Rate now and dpr (on the
 * network the Address instead of dpr); the local preview's Browser, Display, Rate now and dpr;
 * nothing running: one cell "Source · No game running". Unknown: "—".
 *
 * @param input - The source, its label, its second and the computer's engine.
 * @param input.source - activeSource.current().
 * @param input.label - activeSource.label().
 * @param input.second - The source's newest second.
 * @param input.computerEngine - link.engine().
 * @returns The cells.
 * @example
 * ```ts
 * factsOf({ source, label, second, computerEngine }).map(fact => fact.label); // ["OS", "Browser", "Build", "Display", "Rate now", "dpr"]
 * ```
 */
export function factsOf(input: {
  readonly source: ActiveSource;
  readonly label: SourceLabel;
  readonly second: PerfSecond | undefined;
  readonly computerEngine: string | undefined;
}): Fact[] {
  const { source, label, second } = input;
  if (source.kind === "local" && source.session === null) {
    return [{ label: "Source", value: "No game running" }];
  }
  const hz = second?.display?.hz ?? second?.rate.displayHz ?? undefined;
  const browser: Fact = { label: "Browser", value: browserOf(second?.device) ?? DASH };
  const display: Fact = {
    label: "Display",
    value: hz === undefined || hz === null ? DASH : `${hz} Hz`
  };
  const dpr: Fact = { label: "dpr", value: dprText(second?.display?.dpr) };
  if (source.kind !== "device") return [browser, display, rateFact(second), dpr];
  const last: Fact =
    label.link.kind === "network" ? { label: "Address", value: label.link.address ?? DASH } : dpr;
  return [
    { label: "OS", value: osOf(second?.device) ?? DASH },
    browser,
    buildFact(second, input.computerEngine),
    display,
    rateFact(second),
    last
  ];
}

/**
 * The paused chip of a device source (spec 09 § M7): what happened to the local preview.
 *
 * @example
 * ```ts
 * const chip: PausedChip = { bold: "Local preview paused", rest: "while Galaxy A26 is connected", tone: "plain", busy: false };
 * ```
 */
export type PausedChip = {
  readonly bold: string;
  readonly rest: string;
  readonly tone: Tone;
  readonly busy: boolean;
};

/**
 * The paused chip, device sources only: paused by the source, held by you, could not pause (warn,
 * with the reason), pausing or resuming (busy).
 *
 * @param source - activeSource.current().
 * @param preview - activeSource.preview().
 * @param name - The source's name.
 * @returns The chip; undefined for a local source or no local preview.
 * @example
 * ```ts
 * pausedChip(phone, { state: "unpausable", reason: "the build has no game.pause" }, "Galaxy A26");
 * // { bold: "Could not pause the local preview:", rest: "the build has no game.pause", tone: "warn", busy: false }
 * ```
 */
export function pausedChip(
  source: ActiveSource,
  preview: LocalPreview,
  name: string
): PausedChip | undefined {
  if (source.kind !== "device") return undefined;
  switch (preview.state) {
    case "paused-by-source": {
      return {
        bold: "Local preview paused",
        rest: `while ${name} is connected`,
        tone: "plain",
        busy: false
      };
    }
    case "held": {
      return { bold: "Local preview held", rest: "by you", tone: "plain", busy: false };
    }
    case "unpausable": {
      return {
        bold: "Could not pause the local preview:",
        rest: preview.reason,
        tone: "warn",
        busy: false
      };
    }
    case "pausing": {
      return { bold: "Pausing the local preview…", rest: "", tone: "plain", busy: true };
    }
    case "resuming": {
      return { bold: "Resuming…", rest: "", tone: "plain", busy: true };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The muted words before the actions on the local preview: "No device connected", or with nothing
 * running "Start the preview or".
 *
 * @param source - activeSource.current().
 * @returns The words; undefined for a device.
 * @example
 * ```ts
 * actionsNote({ kind: "local", session: null }); // "Start the preview or"
 * ```
 */
export function actionsNote(source: ActiveSource): string | undefined {
  if (source.kind === "device") return undefined;
  return source.kind === "local" && source.session === null
    ? "Start the preview or"
    : "No device connected";
}
