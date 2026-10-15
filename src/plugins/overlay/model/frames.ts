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
  const chrome = device.webview === null ? undefined : /(\d+)/.exec(device.webview)?.[1];
  const parts: string[] = [];
  if (ios !== undefined) parts.push(`iOS ${ios}`);
  if (android !== undefined) parts.push(`Android ${android}`);
  if (chrome !== undefined) parts.push(`WebView ${chrome}`);
  else if (ua.includes("AppleWebKit")) parts.push("WebKit");
  return parts.length === 0 ? DASH : parts.join(", ");
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

/**
 * The drawn / loop cell with its rate suffix after the value on the wide card. On the compact card
 * (decision "Compact card: the rate suffix moves to the label line", option 1; design check P7) the
 * value is the two numbers alone, the label line reads "fps" with the suffix after it, and the
 * cell's title carries "drawn / loop" and the mode.
 *
 * @param second - perf's second.
 * @param compact - The compact card.
 * @returns The cell.
 */
function fpsCell(second: PerfSecond, compact: boolean): CounterCell {
  const value = `${second.fps.drawn} / ${second.fps.loop}`;
  const rate = rateSuffix(second.rate);
  if (!compact) return cellOf("fps", DRAWN_LOOP, value, { unit: "fps", rate });
  return cellOf("fps", "fps", value, {
    rate,
    ratePlace: "label",
    title: rate === undefined ? DRAWN_LOOP : `${DRAWN_LOOP} · ${rate.title}`
  });
}

/**
 * The counter cells: the prototype's 4 / 4 / 4 row, then passes, draws (3 / 3) and texture (6);
 * without a GPU timer (P9) device and heap (6 / 6) instead; compact (C7): the first three only.
 *
 * @param second - perf's second.
 * @param gpuAvg - `meanGpu(window)`: undefined without a measured GPU time.
 * @param compact - The compact card.
 * @param gpuTimer - Whether the page has a GPU timer.
 * @returns The cells, in order.
 */
export function counterCells(
  second: PerfSecond,
  gpuAvg: number | undefined,
  compact: boolean,
  gpuTimer: boolean
): readonly CounterCell[] {
  const sample = second.sample;
  const p90 = sample?.gapMs?.p90;
  const first = [
    fpsCell(second, compact),
    cellOf("p90", "p90 frame", oneDecimal(p90), {
      unit: "ms",
      caution: typeof p90 === "number" && p90 > second.budgetMs
    }),
    gpuAvg === undefined
      ? cellOf("gpu", "GPU avg", DASH, { unit: "no timer" })
      : cellOf("gpu", "GPU avg", oneDecimal(gpuAvg), { unit: "ms" })
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
