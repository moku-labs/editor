/**
 * @file overlay plugin — the Frames tab's view model (C2, C7, C8, D1): the counter cells with the
 * rate suffix, the More text, the device label, the prev / next counter and the notes. Pure.
 */
import type { PerfRate, PerfSampleLine, PerfSecond, PerfStatus } from "../../perf/protocol";
import { groupDigits, oneDecimal, wholeText } from "./format";
import type { CounterCell, MorePart, NavView, RateSuffix } from "./types";

/** "Not measured" in a counter or the More text. */
const DASH = "—";

/** The note of a build without a frame monitor. */
const NO_MONITOR =
  "No frame monitor in this build. It needs @moku-labs/game with the monitor (block 2b) on a dev or debug page.";

/** The note of a game without a renderer. */
const NO_RENDERER = "This game has no renderer (a headless run).";

/** The note while the monitor has no frames yet. */
const WAITING = "Waiting for the first frames.";

/** The reason of a null redraws / rebuilds count. */
const DEV_ONLY = " dev builds only";

/** How many systems the More text names. */
const TOP_SYSTEMS = 3;

/**
 * One counter cell.
 *
 * @param key - The cell key.
 * @param label - The label.
 * @param value - The value.
 * @param extra - Unit, span, caution and the rate suffix.
 * @returns The cell.
 */
function cellOf(
  key: CounterCell["key"],
  label: string,
  value: string,
  extra: Partial<
    Pick<CounterCell, "unit" | "span" | "caution" | "rate" | "ratePlace" | "title">
  > = {}
): CounterCell {
  return {
    key,
    label,
    value,
    unit: extra.unit ?? "",
    span: extra.span ?? 4,
    caution: extra.caution ?? false,
    rate: extra.rate,
    ratePlace: extra.ratePlace ?? "value",
    title: extra.title ?? extra.rate?.title
  };
}

/**
 * The `@<fps>` suffix of the drawn / loop cell: the loop's rate now, amber when the automatic rule
 * fell back below the display, with the mode in its title. None while the rate is unknown (an
 * engine before spec 21: the mode, reason and display fields are null and only `fps` may show).
 *
 * @param rate - perf's rate.
 * @returns The suffix, or undefined.
 * @example
 * ```ts
 * rateSuffix({ fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }); // { text: "@60", caution: true, title: "60 fps, auto (missed); display 120 Hz" }
 * ```
 */
export function rateSuffix(rate: PerfRate): RateSuffix | undefined {
  if (rate.fps === null) return undefined;

  const fell = rate.mode === "auto" && rate.displayHz !== null && rate.fps < rate.displayHz;
  let title = `${rate.fps} fps`;
  if (rate.mode !== null) title += `, ${rate.mode}`;
  if (fell && rate.reason !== null) title += ` (${rate.reason})`;
  if (rate.displayHz !== null) title += `; display ${rate.displayHz} Hz`;
  return { text: `@${rate.fps}`, caution: fell, title };
}

/**
 * The OS and web engine of a device, from its user agent and `webview` (the Chrome major).
 *
 * @param device - perf's device facts.
 * @returns "Android 15, WebView 141", "iOS 18, WebKit" or "—".
 * @example
 * ```ts
 * deviceLabel({ userAgent: "Mozilla/5.0 (Linux; Android 15; SM-A266B)", model: "SM-A266B", modelFrom: "ua", webview: "141", cores: 8, memoryGb: 6 }); // "Android 15, WebView 141"
 * ```
 */
export function deviceLabel(device: PerfSecond["device"]): string {
  if (device === null) return DASH;

  const ua = device.userAgent;
  const ios = /OS (\d+)[._]\d.* like Mac OS X/.exec(ua)?.[1];
  const android = /Android (\d+)/.exec(ua)?.[1];
  const parts: string[] = [];
  if (ios !== undefined) parts.push(`iOS ${ios}`);
  if (android !== undefined) parts.push(`Android ${android}`);
  const browser = browserLabel(device);
  if (browser !== undefined) parts.push(browser);
  return parts.length === 0 ? DASH : parts.join(", ");
}

/**
 * The web engine of a device (as renderView's `browserOf`). An engine that writes `device.browser`
 * (game@0fda201) sets `webview` only in a WebView: `WebView N` then, else `Chrome N` from `browser`,
 * nothing without a Chrome major (Safari). An older log: `WebView N` from any `webview`, else
 * `WebKit` on a WebKit user agent.
 *
 * @param device - perf's device facts.
 * @returns The label, or undefined.
 */
function browserLabel(device: NonNullable<PerfSecond["device"]>): string | undefined {
  const { webview, browser } = device;
  const major = webview === null ? undefined : /(\d+)/.exec(webview)?.[1];
  if (major !== undefined) return `WebView ${major}`;
  if (browser !== undefined) return browser === null ? undefined : `Chrome ${browser}`;
  return device.userAgent.includes("AppleWebKit") ? "WebKit" : undefined;
}

/**
 * The texture counter: art / targets / kept MB, kept from `renderer.stats().kept.mb` (the
 * sample's own `textures.kept` only for an engine without kept pictures).
 *
 * @param second - perf's second.
 * @returns The value text.
 */
function textureText(second: PerfSecond): string {
  const textures = second.sample?.textures;
  if (textures === undefined) return DASH;

  const kept = second.render?.kept?.mb ?? textures.kept;
  return `${wholeText(textures.art)} / ${wholeText(textures.targets)} / ${wholeText(kept)}`;
}

/** The drawn / loop cell's full name, kept in the compact cell's title. */
const DRAWN_LOOP = "drawn / loop";

/** The drawn / loop cell's value while the screen rests. */
const IDLE_WORD = "idle";

/**
 * The drawn / loop cell with its rate suffix after the value on the wide card. On the compact card
 * (decision "Compact card: the rate suffix moves to the label line", option 1; design check P7) the
 * value is the two numbers alone, the label line reads "fps" with the suffix after it, and the
 * cell's title carries "drawn / loop" and the mode. While the screen rests (spec 03 delta
 * 2026-10-15) the value reads `idle` with how long as its unit, the suffix on the label line.
 *
 * @param second - perf's second.
 * @param compact - The compact card.
 * @param idleFor - How long the screen has rested ("" when unknown); undefined while awake.
 * @returns The cell.
 */
function fpsCell(second: PerfSecond, compact: boolean, idleFor: string | undefined): CounterCell {
  const rate = rateSuffix(second.rate);
  const label = compact ? "fps" : DRAWN_LOOP;
  const title = compact && rate !== undefined ? `${DRAWN_LOOP} · ${rate.title}` : undefined;
  if (idleFor !== undefined) {
    return cellOf("fps", label, IDLE_WORD, {
      unit: idleFor,
      rate,
      ratePlace: "label",
      title: title ?? (compact ? DRAWN_LOOP : rate?.title)
    });
  }
  const value = `${second.fps.drawn} / ${second.fps.loop}`;
  if (!compact) return cellOf("fps", DRAWN_LOOP, value, { unit: "fps", rate });
  return cellOf("fps", "fps", value, { rate, ratePlace: "label", title: title ?? DRAWN_LOOP });
}

/**
 * The p90 frame time the counters show: the awake frames' (perf's `activity`), or the sample's gap
 * p90 from an agent before the delta.
 *
 * @param second - perf's second.
 * @returns The p90, ms; null or undefined when unknown.
 */
function p90Of(second: PerfSecond): number | null | undefined {
  return second.activity === undefined ? second.sample?.gapMs?.p90 : second.activity.p90Ms;
}

/**
 * The GPU times the headline reads (`WindowFacts`): the window's p50 / p90, or the mean from an
 * agent before spec 03 delta item 8.
 */
export type GpuFacts = {
  readonly gpuAvg?: number | undefined;
  readonly gpuP50?: number | undefined;
  readonly gpuP90?: number | undefined;
};

/** The GPU cell's label on the wide card. */
const GPU_LABEL = "GPU p50 / p90";

/** GPU times from here print whole: "250", not "250.4". */
const WHOLE_GPU_MS = 100;

/**
 * A GPU time: one decimal under 100 ms, whole above.
 *
 * @param ms - The time.
 * @returns The text.
 */
function gpuText(ms: number): string {
  return ms < WHOLE_GPU_MS ? oneDecimal(ms) : wholeText(ms);
}

/**
 * The GPU cell: the window's p50 / p90 in ms (on the compact card without spaces, the unit in its
 * title), the mean from an agent before the delta, else a dash without a timer.
 *
 * @param gpu - The GPU times.
 * @param compact - The compact card.
 * @returns The cell.
 */
function gpuCell(gpu: GpuFacts | undefined, compact: boolean): CounterCell {
  const p50 = gpu?.gpuP50;
  const p90 = gpu?.gpuP90;
  if (p50 !== undefined && p90 !== undefined) {
    if (!compact) {
      return cellOf("gpu", GPU_LABEL, `${gpuText(p50)} / ${gpuText(p90)}`, { unit: "ms" });
    }
    return cellOf("gpu", "GPU p50/p90", `${gpuText(p50)}/${gpuText(p90)}`, {
      title: `${GPU_LABEL}, ms`
    });
  }
  const avg = gpu?.gpuAvg;
  if (avg === undefined) return cellOf("gpu", "GPU avg", DASH, { unit: "no timer" });
  return cellOf("gpu", "GPU avg", oneDecimal(avg), { unit: "ms" });
}

/**
 * The counter cells: the prototype's 4 / 4 / 4 row, then passes, draws (3 / 3) and texture (6);
 * without a GPU timer (P9) device and heap (6 / 6) instead; compact (C7): the first three only.
 *
 * @param second - perf's second.
 * @param gpu - The GPU times (the window's p50 / p90, or a mean); undefined without one.
 * @param compact - The compact card.
 * @param gpuTimer - Whether the page has a GPU timer.
 * @param idleFor - How long the screen has rested ("" when unknown); undefined while awake.
 * @returns The cells, in order.
 */
export function counterCells(
  second: PerfSecond,
  gpu: GpuFacts | undefined,
  compact: boolean,
  gpuTimer: boolean,
  idleFor?: string
): readonly CounterCell[] {
  const sample = second.sample;
  const p90 = p90Of(second);
  const first = [
    fpsCell(second, compact, idleFor),
    cellOf("p90", "p90 frame", oneDecimal(p90), {
      unit: "ms",
      caution: typeof p90 === "number" && p90 > second.budgetMs
    }),
    gpuCell(gpu, compact)
  ];
  if (compact) return first;

  if (!gpuTimer) {
    const heap = sample?.heapMb;
    return [
      ...first,
      cellOf("device", `device, ${deviceLabel(second.device)}`, second.device?.model ?? DASH, {
        span: 6
      }),
      cellOf("heap", "heap", wholeText(heap), {
        unit: typeof heap === "number" ? "MB" : "not in WebKit",
        span: 6
      })
    ];
  }

  const draws = sample?.draws?.mean;
  return [
    ...first,
    cellOf("passes", "passes", wholeText(sample?.passes?.mean), { span: 3 }),
    cellOf("draws", "draws", wholeText(draws), {
      unit: typeof draws === "number" ? "" : "on WebGL",
      span: 3
    }),
    cellOf("texture", "texture art / targets / kept", textureText(second), {
      unit: "MB",
      span: 6
    })
  ];
}

/**
 * The three slowest systems of the second, by mean.
 *
 * @param sample - The newest sample, or null.
 * @returns "frost-apply 2.1 · ripple 1.4 · glass 0.9 ms" or "—".
 * @example
 * ```ts
 * systemsText(null); // "—"
 * ```
 */
export function systemsText(sample: PerfSampleLine | null): string {
  const systems = sample?.systems;
  if (systems === null || systems === undefined || systems.length === 0) return DASH;

  const top = systems.toSorted((a, b) => b.mean - a.mean).slice(0, TOP_SYSTEMS);
  const named = top.map(system => `${system.name} ${system.mean.toFixed(1)}`);
  return `${named.join(" · ")} ms`;
}

/**
 * A More part of a number that may be null: `label <b>N</b>` or `label — reason`.
 *
 * @param label - The label.
 * @param value - The number.
 * @param reason - The text after "—" when null.
 * @param unit - The unit after the number.
 * @returns The part.
 */
function numberPart(
  label: string,
  value: number | null | undefined,
  reason = "",
  unit = ""
): MorePart {
  return typeof value === "number"
    ? { label, value: groupDigits(value), rest: unit }
    : { label, value: DASH, rest: reason };
}

/**
 * The screen facts of the More text: insets, backend, canvas and scale, device.
 *
 * @param second - perf's second.
 * @returns The parts.
 */
function screenParts(second: PerfSecond): MorePart[] {
  const display = second.display;
  if (display === null) {
    return [
      { label: "insets", value: DASH, rest: "" },
      { label: "device", value: second.device?.model ?? DASH, rest: "" }
    ];
  }

  const { t, b, l, r } = display.safeArea;
  const hz = second.sample?.ticks;
  return [
    { label: "insets", value: `t${t} b${b} l${l} r${r}`, rest: "" },
    { label: "backend", value: display.backend, rest: "" },
    {
      label: "canvas",
      value: `${display.canvas.w} × ${display.canvas.h}`,
      rest: `, scale ${display.resolution.toFixed(1)}`
    },
    {
      label: "device",
      value: second.device?.model ?? DASH,
      rest: `, ${hz ?? DASH} Hz, dpr ${display.dpr}`
    }
  ];
}

/**
 * The More text (D1): filters, kept pictures and retakes, passes max, redraws, rebuilds, views,
 * heap, then the screen facts; the compact card prefixes passes, draws and texture. A null value
 * reads "—" with its reason.
 *
 * @param second - perf's second.
 * @param compact - The compact card.
 * @returns The parts, in order.
 */
export function moreParts(second: PerfSecond, compact: boolean): readonly MorePart[] {
  const sample = second.sample;
  const render = second.render;
  const kept = render?.kept;
  const prefix: MorePart[] = compact
    ? [
        numberPart("passes", sample?.passes?.mean),
        numberPart("draws", sample?.draws?.mean, " on WebGL"),
        { label: "texture", value: textureText(second), rest: " MB" }
      ]
    : [];
  return [
    ...prefix,
    numberPart("filters", sample?.filters?.applies.mean),
    kept === null || kept === undefined
      ? { label: "kept", value: DASH, rest: " engine without kept pictures" }
      : { label: "kept", value: String(kept.pictures), rest: ` pictures, ${kept.retakes} retakes` },
    numberPart("passes max", render?.passesMax),
    numberPart("redraws", render?.redraws, DEV_ONLY),
    numberPart("rebuilds", render?.rebuilds, DEV_ONLY),
    numberPart("views", sample?.views),
    numberPart("heap", sample?.heapMb, " not in WebKit", " MB"),
    ...screenParts(second)
  ];
}

/**
 * The More text as plain text: `label value rest`, joined by " · ".
 *
 * @param parts - The parts.
 * @returns The text.
 * @example
 * ```ts
 * moreText([{ label: "heap", value: "151", rest: " MB" }]); // "heap 151 MB"
 * ```
 */
export function moreText(parts: readonly MorePart[]): string {
  return parts.map(part => `${part.label} ${part.value}${part.rest}`).join(" · ");
}

/**
 * The prev / next counter: `ordinal/total`, `–` for an ordinal of 0; disabled without spikes.
 *
 * @param total - Spikes in the window.
 * @param ordinal - The position of the selected spike, 0 for none.
 * @returns The nav view.
 * @example
 * ```ts
 * navView(6, 5); // { counter: "5/6", disabled: false }
 * ```
 */
export function navView(total: number, ordinal: number): NavView {
  return { counter: `${ordinal > 0 ? ordinal : "–"}/${total}`, disabled: total === 0 };
}

/**
 * The note that replaces the graph: no monitor, no renderer, or waiting for frames.
 *
 * @param status - perf's status.
 * @returns The note; undefined while the monitor measures.
 * @example
 * ```ts
 * framesNote({ state: "waiting" }); // "Waiting for the first frames."
 * ```
 */
export function framesNote(status: PerfStatus): string | undefined {
  if (status.state === "waiting") return WAITING;
  if (status.state === "off") return status.reason === "no-renderer" ? NO_RENDERER : NO_MONITOR;
  return undefined;
}
