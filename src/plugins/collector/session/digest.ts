/* eslint-disable unicorn/no-null -- null is "not measured" on SessionDigest */
/**
 * @file collector plugin — the live digest of a device log (`SessionDigest`, the newest second
 * for the CLI's live line). It switches on the `kind` of typed PerfLogLine items and reads every
 * field beyond `v` and `kind` defensively: the hub's shallow guard vouches for those two only, so a
 * line missing a field is skipped here and still written.
 */
import { normalizeModel } from "../../hub/protocol";
import type {
  PerfCause,
  PerfEventLine,
  PerfHeaderLine,
  PerfLogLine,
  PerfSampleLine,
  PerfSpikeLine,
  PerfThermalLine
} from "../../perf/protocol";
import { headerRate, primaryOf, rankCauses } from "../report";
import type { DigestFacts, LogSession, SessionDigest } from "../types";

/** The most recent spikes a log keeps for the digest's causes. */
export const RECENT_MAX = 64;

/** The window of the digest's causes, ms of page clock. */
export const CAUSE_WINDOW_MS = 6000;

/** The part of a session the digest reads and writes. */
type DigestTarget = Pick<LogSession, "digest" | "facts" | "recent" | "model" | "build">;

/** What one sample gives the digest. */
type Second = Pick<SessionDigest, "t" | "path" | "fps" | "loopFps" | "p90Ms" | "gpuMs" | "spikes">;

/**
 * Whether a value is a finite number.
 *
 * @param value - A field of a line.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isFiniteNumber(Number.NaN); // false
 * ```
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A finite number, else null.
 *
 * @param value - A field of a line.
 * @returns The number or null.
 * @example
 * ```ts
 * finiteOrNull("9"); // null
 * ```
 */
function finiteOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

/**
 * The render backend a header names, else null.
 *
 * @param value - The header's `gpu.backend`.
 * @returns The backend or null.
 * @example
 * ```ts
 * backendOf("webgl"); // "webgl"
 * ```
 */
function backendOf(value: unknown): SessionDigest["backend"] {
  return value === "webgpu" || value === "webgl" || value === "none" ? value : null;
}

/**
 * The primary causes of the spikes of the last 6 s before `end`, most frequent first.
 *
 * @param recent - The recent spikes: [page t, cause].
 * @param end - The newest page t of the log.
 * @returns The causes.
 * @example
 * ```ts
 * recentCauses([[1000, "gpu"], [5000, "js"]], 8000); // ["js"]
 * ```
 */
function recentCauses(recent: readonly (readonly [number, PerfCause])[], end: number): PerfCause[] {
  const counts = new Map<PerfCause, number>();
  for (const [t, cause] of recent) {
    if (t > end - CAUSE_WINDOW_MS) counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }

  return rankCauses(counts).map(([cause]) => cause);
}

/**
 * The digest of a second with what the log heard besides samples.
 *
 * @param session - The log.
 * @param second - The newest second.
 * @returns A fresh digest.
 */
function digestOf(session: DigestTarget, second: Second): SessionDigest {
  const { facts, recent } = session;
  const newestSpike = recent.at(-1)?.[0] ?? second.t;
  return {
    t: second.t,
    path: second.path,
    fps: second.fps,
    loopFps: second.loopFps,
    p90Ms: second.p90Ms,
    gpuMs: second.gpuMs,
    spikes: second.spikes,
    rate: facts.rate,
    causes: recentCauses(recent, Math.max(second.t, newestSpike)),
    thermal: facts.thermal,
    model: facts.model ?? session.model,
    backend: facts.backend,
    engine: facts.engine,
    build: session.build
  };
}

/**
 * What a sample gives the digest, or undefined for a sample without a finite `t`, a string
 * `path`, a positive `windowMs` and finite `drawn` and `frames`.
 *
 * @param sample - The sample line.
 * @returns The second, or undefined.
 */
function secondOf(sample: PerfSampleLine): Second | undefined {
  const { t, path, windowMs, drawn, frames } = sample;
  const readable =
    isFiniteNumber(t) &&
    typeof path === "string" &&
    isFiniteNumber(windowMs) &&
    windowMs > 0 &&
    isFiniteNumber(drawn) &&
    isFiniteNumber(frames);
  if (!readable) return undefined;

  return {
    t,
    path,
    fps: Math.round((drawn * 1000) / windowMs),
    loopFps: Math.round((frames * 1000) / windowMs),
    p90Ms: finiteOrNull(sample.gapMs?.p90),
    gpuMs: finiteOrNull(sample.gpuMs?.p50),
    spikes: isFiniteNumber(sample.spikes) ? sample.spikes : 0
  };
}

/**
 * A header: the build, and the model, backend, engine and rate the digest names.
 *
 * @param session - The log.
 * @param header - The header line.
 */
function readHeader(session: DigestTarget, header: PerfHeaderLine): void {
  const { facts } = session;
  if (typeof header.build === "string") session.build = header.build;
  if (typeof header.engine === "string") facts.engine = header.engine;
  facts.model = normalizeModel(header.device?.model) ?? facts.model;
  facts.backend = backendOf(header.gpu?.backend) ?? facts.backend;
  facts.rate = headerRate(header) ?? facts.rate;
}

/**
 * A spike: its primary cause joins the recent spikes (at most 64).
 *
 * @param session - The log.
 * @param spike - The spike line.
 */
function readSpike(session: DigestTarget, spike: PerfSpikeLine): void {
  const causes = spike.frame?.causes;
  const cause = Array.isArray(causes) ? primaryOf(causes) : undefined;
  if (!isFiniteNumber(spike.t) || cause === undefined) return;

  session.recent.push([spike.t, cause]);
  if (session.recent.length > RECENT_MAX) session.recent.shift();
}

/**
 * A heat reading (device shell or adb): the newest status and battery temperature.
 *
 * @param facts - What the log heard.
 * @param line - The thermal line.
 */
function readThermal(facts: DigestFacts, line: PerfThermalLine): void {
  const { status } = line;
  facts.thermal = {
    status: typeof status === "string" || isFiniteNumber(status) ? status : null,
    batteryC: finiteOrNull(line.batteryC)
  };
}

/**
 * An event: a `rate` event's `to` is the rate from now on.
 *
 * @param facts - What the log heard.
 * @param event - The event line.
 */
function readRate(facts: DigestFacts, event: PerfEventLine): void {
  const to = event.detail?.to;
  if (event.name === "rate" && isFiniteNumber(to)) facts.rate = to;
}

/**
 * Reads one device or collector line into a log's digest: a sample replaces the newest second, a
 * header, spike, thermal or `rate` event updates what the digest names. Never throws on a
 * malformed line: it is skipped here and still written.
 *
 * @param session - The log.
 * @param item - The line, typed PerfLogLine (only `v` and `kind` vouched for).
 */
export function readLine(session: DigestTarget, item: PerfLogLine): void {
  switch (item.kind) {
    case "sample": {
      const second = secondOf(item);
      if (second !== undefined) session.digest = digestOf(session, second);
      return;
    }
    case "header": {
      readHeader(session, item);
      break;
    }
    case "spike": {
      readSpike(session, item);
      break;
    }
    case "thermal": {
      readThermal(session.facts, item);
      break;
    }
    case "event": {
      readRate(session.facts, item);
      break;
    }
    default: {
      return;
    }
  }

  if (session.digest !== null) session.digest = digestOf(session, session.digest);
}
