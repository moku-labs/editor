/* eslint-disable unicorn/no-null -- null is "not measured" on the summary's values */
/**
 * @file collector/report — `summarize`: one pass per array of a parsed log into per-screen,
 * per-rate tallies (fixed 81-slot histograms, Map tallies, no array copies per line), heat per
 * device, system frames per mark segment, the marks and the rate switches. Linear in the number of
 * lines: an array is sorted by `t` only when it is not in order already. Also the small rules the
 * collector's live digest shares: the primary cause of a spike, the rate of a header, the order of
 * cause counts. Pure.
 */
import type {
  PerfCause,
  PerfCollectorLine,
  PerfEventLine,
  PerfHeaderLine,
  PerfMarkLine,
  PerfSampleLine,
  PerfSpikeLine,
  PerfThermalLine
} from "../../perf/protocol";
import {
  CAUSE_BITS,
  CAUSE_RANK,
  causeName,
  PERF_GAP_BUCKETS,
  primaryCause,
  rateFps
} from "../../perf/protocol";
import { gfxPercentile, histPercentile } from "./hist";
import { isOverlayWhat } from "./parse";
import type { HeatSummary, LogSummary, ParsedLog, ScreenSummary, SystemSummary } from "./types";

/** The tally of one screen at one rate. */
type Tally = {
  readonly path: string;
  readonly rate: number | null;
  windowMs: number;
  readonly hist: number[];
  gpuSum: number;
  gpuFrames: number;
  spikes: number;
  readonly causes: Map<PerfCause, number>;
  passesSum: number;
  passesWeight: number;
  art: number;
  targets: number;
  kept: number;
  heap: number | null;
  readonly poolTrims: { count: number; freedMb: number };
  readonly warmUps: { count: number; draws: number };
  readonly overlays: Map<string, ScreenSummary["overlays"][number]>;
};

/** A sample's second and the tally it counted under (frame events join it). */
type Owner = { readonly t: number; readonly tally: Tally };

/** First, last and max of a reading over a log. */
type Range = { first: number | null; last: number | null; max: number | null };

/** The heat of one device being tallied. */
type HeatTally = {
  readonly device: string;
  readonly batteryC: Range;
  readonly status: Range;
  readonly sensors: Map<string, { first: number; last: number }>;
};

/** System frames of one device in one mark segment being tallied. */
type SystemTally = {
  readonly device: string;
  readonly mark: string;
  seconds: number;
  frames: number;
  janky: number;
  readonly hist: Map<number, number>;
};

/** The segment of system frames before the first mark. */
const START_SEGMENT = "(start)";

/** The most sensors a heat summary lists. */
const MAX_SENSORS = 4;

/** Milliseconds of a second. */
const SECOND_MS = 1000;

/** Seconds of a minute. */
const MINUTE_S = 60;

/**
 * Whether a value is a finite number.
 *
 * @param value - A value read from a line.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isFiniteNumber("5"); // false
 * ```
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A finite number, else null.
 *
 * @param value - A value read from a line.
 * @returns The number or null.
 * @example
 * ```ts
 * finiteOrNull(Number.NaN); // null
 * ```
 */
function finiteOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

/**
 * A string, else null.
 *
 * @param value - A value read from a line.
 * @returns The string or null.
 * @example
 * ```ts
 * textOrNull(42); // null
 * ```
 */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Lines in `t` order: the array itself when it is in order already (one linear check), else a
 * sorted copy.
 *
 * @param lines - Lines with a `t`.
 * @returns The lines by `t`.
 * @example
 * ```ts
 * byTime([{ t: 2 }, { t: 1 }]); // [{ t: 1 }, { t: 2 }]
 * ```
 */
function byTime<Line extends { readonly t: number }>(lines: readonly Line[]): readonly Line[] {
  let previous = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    if (line.t < previous) return lines.toSorted((one, other) => one.t - other.t);
    previous = line.t;
  }

  return lines;
}

/**
 * The editor's primary cause of a spike from its cause names (gpu › upload › compile ›
 * longFrame › js › gc? › gap): the names become the engine's bits, then `primaryCause` ranks them.
 *
 * @param causes - The frame's `causes` (names a reader did not check).
 * @returns The primary cause; undefined for none.
 * @example
 * ```ts
 * primaryOf(["js", "upload"]); // "upload"
 * ```
 */
export function primaryOf(causes: readonly unknown[]): PerfCause | undefined {
  let bits = 0;
  for (const [bit, name] of CAUSE_BITS.entries()) {
    if (causes.includes(name)) bits |= 1 << bit;
  }

  return causeName(primaryCause(bits));
}

/**
 * The loop's rate a header names: `rate.fps` (spec 21), else `config.maxFps` when > 0.
 *
 * @param header - The header line, read defensively.
 * @returns The rate in fps; null when the header names none.
 * @example
 * ```ts
 * headerRate(null); // null: a log without a header names no rate
 * ```
 */
export function headerRate(header: PerfHeaderLine | null): number | null {
  const fps = header?.rate?.fps;
  if (isFiniteNumber(fps) && fps > 0) return fps;

  const maxFps = header?.config?.maxFps;
  return isFiniteNumber(maxFps) && maxFps > 0 ? maxFps : null;
}

/**
 * Cause counts, most first; a tie goes to the higher-ranked cause.
 *
 * @param counts - Count by cause.
 * @returns `[cause, count]` pairs.
 * @example
 * ```ts
 * rankCauses(new Map([["js", 1], ["upload", 1]])); // [["upload", 1], ["js", 1]]
 * ```
 */
export function rankCauses(counts: ReadonlyMap<PerfCause, number>): [PerfCause, number][] {
  return [...counts].toSorted(
    (one, other) => other[1] - one[1] || CAUSE_RANK.indexOf(one[0]) - CAUSE_RANK.indexOf(other[0])
  );
}

/**
 * The tally of a screen at a rate, made on first use.
 *
 * @param tallies - The tallies by `path@rate`.
 * @param path - The flow path.
 * @param rate - The rate in fps, or null.
 * @returns The tally.
 */
function tallyOf(tallies: Map<string, Tally>, path: string, rate: number | null): Tally {
  const key = `${path}@${rate ?? "-"}`;
  const known = tallies.get(key);
  if (known !== undefined) return known;

  const tally: Tally = {
    path,
    rate,
    windowMs: 0,
    hist: Array.from({ length: PERF_GAP_BUCKETS }, () => 0),
    gpuSum: 0,
    gpuFrames: 0,
    spikes: 0,
    causes: new Map(),
    passesSum: 0,
    passesWeight: 0,
    art: 0,
    targets: 0,
    kept: 0,
    heap: null,
    poolTrims: { count: 0, freedMb: 0 },
    warmUps: { count: 0, draws: 0 },
    overlays: new Map()
  };
  tallies.set(key, tally);
  return tally;
}

/**
 * Adds a second's GPU time (p50 weighted by the frames it timed) and passes (mean weighted by
 * the drawn frames).
 *
 * @param tally - The screen's tally.
 * @param sample - The second.
 */
function addWeighted(tally: Tally, sample: PerfSampleLine): void {
  const gpu = sample.gpuMs;
  if (isFiniteNumber(gpu?.p50) && isFiniteNumber(gpu?.frames) && gpu.frames > 0) {
    tally.gpuSum += gpu.p50 * gpu.frames;
    tally.gpuFrames += gpu.frames;
  }

  const passes = sample.passes?.mean;
  if (isFiniteNumber(passes) && isFiniteNumber(sample.drawn)) {
    tally.passesSum += passes * sample.drawn;
    tally.passesWeight += sample.drawn;
  }
}

/**
 * Keeps the most texture and heap memory of a screen; kept MB from `sample.kept` (spec 23 P12.2),
 * else `textures.kept`.
 *
 * @param tally - The screen's tally.
 * @param sample - The second.
 */
function addMemory(tally: Tally, sample: PerfSampleLine): void {
  const textures = sample.textures;
  const kept = sample.kept ? sample.kept.mb : textures?.kept;
  tally.art = Math.max(tally.art, finiteOrNull(textures?.art) ?? 0);
  tally.targets = Math.max(tally.targets, finiteOrNull(textures?.targets) ?? 0);
  tally.kept = Math.max(tally.kept, finiteOrNull(kept) ?? 0);

  const heap = finiteOrNull(sample.heapMb);
  if (heap !== null) tally.heap = Math.max(tally.heap ?? heap, heap);
}

/**
 * Counts every sample under its screen and the rate in effect at its `t`: the initial rate, then
 * each `rate` line's `to` from its `t` on (a second that holds a switch counts under the new rate).
 *
 * @param samples - The samples by `t`.
 * @param rates - The rate lines by `t`.
 * @param initial - The header's rate.
 * @param tallies - The tallies by `path@rate`.
 * @returns Each sample's second and its tally, in order.
 */
function tallySamples(
  samples: readonly PerfSampleLine[],
  rates: readonly PerfEventLine[],
  initial: number | null,
  tallies: Map<string, Tally>
): Owner[] {
  const owners: Owner[] = [];
  const switches = rates.values();
  let pending = switches.next();
  let rate = initial;

  for (const sample of samples) {
    while (!pending.done && pending.value.t <= sample.t) {
      rate = Number(pending.value.detail.to);
      pending = switches.next();
    }

    const tally = tallyOf(tallies, sample.path, rate);
    tally.windowMs += sample.windowMs;
    const { frameHist } = sample;
    for (const [index, element] of frameHist.entries()) {
      tally.hist[index] = (tally.hist[index] ?? 0) + element;
    }
    addWeighted(tally, sample);
    addMemory(tally, sample);
    owners.push({ t: sample.t, tally });
  }

  return owners;
}

/**
 * Counts every spike under its frame's screen at its frame's own rate, by primary cause.
 *
 * @param spikes - The spikes.
 * @param tallies - The tallies by `path@rate`.
 */
function tallySpikes(spikes: readonly PerfSpikeLine[], tallies: Map<string, Tally>): void {
  for (const { frame } of spikes) {
    const fps = rateFps(frame.rateMs);
    const tally = tallyOf(tallies, frame.path, fps > 0 ? fps : null);
    tally.spikes += 1;

    const cause = primaryOf(frame.causes);
    if (cause !== undefined) tally.causes.set(cause, (tally.causes.get(cause) ?? 0) + 1);
  }
}

/**
 * Adds one frame event to a screen: a pool trim and its MB, a warm-up and its draws, or an
 * overlay change by label and what.
 *
 * @param tally - The screen's tally.
 * @param event - The frame event (its detail checked by parsePerfLog).
 */
function addFrameEvent(tally: Tally, event: PerfEventLine): void {
  const { detail } = event;
  if (event.name === "pool-trim") {
    tally.poolTrims.count += 1;
    tally.poolTrims.freedMb += Number(detail.freedMb);
  } else if (event.name === "warm") {
    tally.warmUps.count += 1;
    tally.warmUps.draws += Number(detail.draws);
  } else if (isOverlayWhat(detail.what)) {
    const label = String(detail.label);
    const key = `${label}\u0000${detail.what}`;
    const entry = tally.overlays.get(key) ?? { label, what: detail.what, count: 0 };
    tally.overlays.set(key, { ...entry, count: entry.count + 1 });
  }
}

/**
 * Counts each frame event under the screen and rate of the sample whose second holds it: the
 * first sample with `t ≥` the event's `t`, else the last sample. A log without samples counts none.
 *
 * @param events - The frame events by `t`.
 * @param owners - Each sample's second and its tally, by `t`.
 */
function tallyFrameEvents(events: readonly PerfEventLine[], owners: readonly Owner[]): void {
  const seconds = owners.values();
  const first = seconds.next();
  if (first.done) return;

  let owner = first.value;
  for (const event of events) {
    while (owner.t < event.t) {
      const next = seconds.next();
      if (next.done) break;
      owner = next.value;
    }
    addFrameEvent(owner.tally, event);
  }
}

/**
 * The summary row of a tally.
 *
 * @param tally - The tally.
 * @returns The row.
 */
function screenOf(tally: Tally): ScreenSummary {
  const seconds = tally.windowMs / SECOND_MS;
  return {
    path: tally.path,
    rate: tally.rate,
    seconds,
    frames: tally.hist.reduce((sum, count) => sum + count, 0),
    p50: histPercentile(tally.hist, 0.5),
    p90: histPercentile(tally.hist, 0.9),
    p99: histPercentile(tally.hist, 0.99),
    gpuMs: tally.gpuFrames > 0 ? tally.gpuSum / tally.gpuFrames : null,
    spikes: tally.spikes,
    spikesPerMin: seconds > 0 ? (tally.spikes * MINUTE_S) / seconds : 0,
    causes: rankCauses(tally.causes),
    passes: tally.passesWeight > 0 ? tally.passesSum / tally.passesWeight : null,
    textureMb: { art: tally.art, targets: tally.targets, kept: tally.kept },
    heapMb: tally.heap,
    poolTrims: { ...tally.poolTrims },
    warmUps: { ...tally.warmUps },
    overlays: [...tally.overlays.values()]
  };
}

/**
 * Adds a reading to a first / last / max range; null is skipped.
 *
 * @param range - The range.
 * @param value - The reading.
 */
function addReading(range: Range, value: number | null): void {
  if (value === null) return;

  range.first ??= value;
  range.last = value;
  range.max = Math.max(range.max ?? value, value);
}

/**
 * Adds a thermal line's sensors to a device's heat: the first reading of each and the newest.
 *
 * @param tally - The device's heat.
 * @param sensors - The line's sensors, read defensively.
 */
function addSensors(tally: HeatTally, sensors: unknown): void {
  if (typeof sensors !== "object" || sensors === null) return;

  for (const [name, value] of Object.entries(sensors)) {
    if (!isFiniteNumber(value)) continue;

    const known = tally.sensors.get(name);
    tally.sensors.set(name, { first: known?.first ?? value, last: value });
  }
}

/**
 * The heat of each device over the log: battery, thermal status (numbers only) and sensors. A
 * shell line's null device reads as the header's model.
 *
 * @param thermal - The thermal lines by `t`.
 * @param model - The header's model.
 * @returns One heat summary per device, in first-seen order.
 */
function heatOf(thermal: readonly PerfThermalLine[], model: string | null): HeatSummary[] {
  const devices = new Map<string, HeatTally>();
  for (const line of thermal) {
    const device = line.device ?? model ?? "device";
    const tally = devices.get(device) ?? {
      device,
      batteryC: { first: null, last: null, max: null },
      status: { first: null, last: null, max: null },
      sensors: new Map()
    };
    devices.set(device, tally);
    addReading(tally.batteryC, finiteOrNull(line.batteryC));
    addReading(tally.status, finiteOrNull(line.status));
    addSensors(tally, line.sensors);
  }

  return [...devices.values()].map(tally => ({
    device: tally.device,
    batteryC: { ...tally.batteryC },
    status: { ...tally.status },
    sensors: [...tally.sensors]
      .map(([name, reading]) => ({ name, ...reading }))
      .toSorted((one, other) => other.last - one.last)
      .slice(0, MAX_SENSORS)
  }));
}

/**
 * Adds a gfx line to its device's tally of a mark segment.
 *
 * @param tally - The tally.
 * @param line - The gfx line.
 */
function addGfx(tally: SystemTally, line: PerfCollectorLine): void {
  tally.seconds += line.seconds;
  tally.frames += line.frames;
  tally.janky += line.janky;
  for (const [ms, count] of Object.entries(line.hist)) {
    if (isFiniteNumber(count))
      tally.hist.set(Number(ms), (tally.hist.get(Number(ms)) ?? 0) + count);
  }
}

/**
 * A number with one decimal at most.
 *
 * @param value - The number.
 * @returns It, rounded to 0.1.
 * @example
 * ```ts
 * round1(41.24); // 41.2
 * ```
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The summary of a device's system frames in one mark segment.
 *
 * @param tally - The tally.
 * @returns The summary.
 */
function systemSummaryOf(tally: SystemTally): SystemSummary {
  const hist = [...tally.hist];
  return {
    device: tally.device,
    mark: tally.mark,
    seconds: tally.seconds,
    frames: tally.frames,
    fps: tally.seconds > 0 ? round1(tally.frames / tally.seconds) : 0,
    latePct: tally.frames > 0 ? round1((tally.janky * 100) / tally.frames) : 0,
    p50: gfxPercentile(hist, 0.5),
    p90: gfxPercentile(hist, 0.9),
    p99: gfxPercentile(hist, 0.99)
  };
}

/**
 * System frames (adb gfxinfo) per device and per mark segment: `(start)` before the first mark,
 * then the label of the newest mark at or before each gfx line.
 *
 * @param gfx - The gfx lines by `t`.
 * @param marks - The marks by `t`.
 * @param model - The header's model, for a line without a device.
 * @returns The summaries, in first-seen order.
 */
function systemOf(
  gfx: readonly PerfCollectorLine[],
  marks: readonly PerfMarkLine[],
  model: string | null
): SystemSummary[] {
  const tallies = new Map<string, SystemTally>();
  const segments = marks.values();
  let pending = segments.next();
  let mark = START_SEGMENT;

  for (const line of gfx) {
    while (!pending.done && pending.value.t <= line.t) {
      mark = pending.value.label;
      pending = segments.next();
    }

    const device = textOrNull(line.device) ?? model ?? "device";
    const key = `${device}\u0000${mark}`;
    const tally = tallies.get(key) ?? {
      device,
      mark,
      seconds: 0,
      frames: 0,
      janky: 0,
      hist: new Map()
    };
    tallies.set(key, tally);
    addGfx(tally, line);
  }

  return [...tallies.values()].map(tally => systemSummaryOf(tally));
}

/**
 * Seconds from the log's origin (its first sample), never negative.
 *
 * @param origin - Page t of the origin.
 * @param t - Page t of a line.
 * @returns The seconds.
 * @example
 * ```ts
 * secondsFrom(1000, 65_000); // 64
 * ```
 */
function secondsFrom(origin: number, t: number): number {
  return Math.max(0, (t - origin) / SECOND_MS);
}

/**
 * Summarizes a parsed log: one row per screen and rate (the same screen at 120 and at 60 fps is
 * two rows) with exact percentiles of the merged `frameHist`, GPU ms, spikes by primary cause,
 * passes, memory and the game's frame events; heat per device; system frames per mark segment;
 * the marks and every rate switch. Rows by seconds, longest first. Linear in the number of lines.
 *
 * @param log - What parsePerfLog read.
 * @returns The summary.
 * @example
 * ```ts
 * summarize(parsePerfLog(text)).screens.map(screen => `${screen.path} @${screen.rate}`); // ["garden/boss @120", "garden/boss @60"]
 * ```
 */
export function summarize(log: ParsedLog): LogSummary {
  const samples = byTime(log.samples);
  const marks = byTime(log.marks);
  const rates = byTime(log.rates);
  const origin = samples[0]?.t ?? marks[0]?.t ?? 0;
  const model = textOrNull(log.header?.device?.model);

  const tallies = new Map<string, Tally>();
  const owners = tallySamples(samples, rates, headerRate(log.header), tallies);
  tallySpikes(log.spikes, tallies);
  tallyFrameEvents(byTime(log.frameEvents), owners);

  return {
    device: {
      model,
      backend: textOrNull(log.header?.gpu?.backend),
      engine: textOrNull(log.header?.engine),
      build: textOrNull(log.header?.build)
    },
    seconds: samples.reduce((sum, sample) => sum + sample.windowMs, 0) / SECOND_MS,
    screens: [...tallies.values()]
      .map(tally => screenOf(tally))
      .toSorted((one, other) => other.seconds - one.seconds),
    heat: heatOf(byTime(log.thermal), model),
    system: systemOf(byTime(log.gfx), marks, model),
    marks: marks.map(mark => ({
      at: secondsFrom(origin, mark.t),
      label: mark.label,
      auto: mark.auto === true
    })),
    rateSwitches: rates.map(rate => ({
      at: secondsFrom(origin, rate.t),
      from: Number(rate.detail.from),
      to: Number(rate.detail.to),
      reason: textOrNull(rate.detail.reason) ?? "",
      mode: textOrNull(rate.detail.mode) ?? ""
    })),
    lost: log.lost,
    lines: log.lines,
    skipped: { ...log.skipped }
  };
}
