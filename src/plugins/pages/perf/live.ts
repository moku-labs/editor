/* eslint-disable unicorn/no-null -- null is "not known" in the memory and the digest (LiveMemory, SessionDigest) */
/**
 * @file pages perf sub-domain — the live lines of a perf run: what one `collector:session` event
 * prints, given what its log printed before (`LiveMemory`): a header with engine and build and a
 * REC line, a STALE warning, a stats line at most every 5 s (at once on a new screen or rate),
 * and the left / done lines. Pure apart from the memory it updates; no cursor movement, so the
 * lines interleave safely with the pairing prompt and log warnings.
 */
import { groupThousands } from "../../collector/report";
import type { CollectorSessionEvent, SessionDigest } from "../../collector/types";
import type { LiveMemory } from "./types";

/** The least time between two stats lines of one log, ms. */
export const LIVE_EVERY_MS = 5000;

/** The start of a STALE line: the caller prints it as a warning. */
const STALE_PREFIX = "STALE: ";

/** The engine id of a checkout without an installed game: never compared. */
const UNKNOWN_ENGINE = "unknown";

/** What a null value prints as. */
const NONE = "—";

/**
 * The memory of a log no event reached yet.
 *
 * @returns A fresh memory.
 * @example
 * ```ts
 * newLiveMemory().state; // undefined
 * ```
 */
export function newLiveMemory(): LiveMemory {
  return {
    engine: null,
    build: null,
    path: null,
    rate: null,
    printedAt: Number.NEGATIVE_INFINITY,
    staleWarned: null,
    state: undefined
  };
}

/**
 * Whether a live line is the STALE warning (printed through `output.warn`).
 *
 * @param line - A line of perfLiveLines.
 * @returns True for the STALE line.
 * @example
 * ```ts
 * isStaleLine("STALE: SM-A266B runs engine 0.14.12+9c41e0, …"); // true
 * ```
 */
export function isStaleLine(line: string): boolean {
  return line.startsWith(STALE_PREFIX);
}

/**
 * Milliseconds with one decimal, or the dash.
 *
 * @param value - The value.
 * @returns e.g. "18.2".
 * @example
 * ```ts
 * msOf(null); // "—"
 * ```
 */
function msOf(value: number | null): string {
  return value === null ? NONE : value.toFixed(1);
}

/**
 * Whether an engine id can be compared: known, and not the checkout's "unknown".
 *
 * @param engine - The engine id.
 * @returns True when it is known.
 * @example
 * ```ts
 * isKnown("unknown"); // false
 * ```
 */
function isKnown(engine: string | null): engine is string {
  return engine !== null && engine !== UNKNOWN_ENGINE;
}

/**
 * The header and REC lines of a log.
 *
 * @param event - The event (its file relative to the root).
 * @param name - The phone's name.
 * @param identity - The engine and build to print.
 * @param identity.engine - The phone's engine, or null.
 * @param identity.build - The phone's build, or null.
 * @returns The two lines.
 * @example
 * ```ts
 * headerLines(event, "SM-A266B", { engine: "0.14.12+9c41e0", build: null })[1]; // "  ● REC → .moku/perf/…"
 * ```
 */
function headerLines(
  event: CollectorSessionEvent,
  name: string,
  identity: { readonly engine: string | null; readonly build: string | null }
): string[] {
  const { device, last } = event;
  const backend = last?.backend ?? null;
  const parts = [
    name,
    ...(backend === null ? [] : [backend]),
    `engine ${identity.engine ?? NONE}`,
    `build ${identity.build ?? NONE}`,
    `${device.link} ${device.address}`
  ];
  return [`◉ ${parts.join(" · ")}`, `  ● REC → ${event.file}`];
}

/**
 * The stats line of a digest.
 *
 * @param digest - The newest digest.
 * @param lines - The log's line count.
 * @param lost - Lines the phone lost.
 * @returns The screen, the rate, fps, p90, gpu, spikes, heat and the line count, two spaces apart.
 * @example
 * ```ts
 * statsLine(digest, 1840, 0); // "  garden/boss  @60  54 fps  …  · 1 840 lines"
 * ```
 */
function statsLine(digest: SessionDigest, lines: number, lost: number): string {
  const { path, rate, fps, p90Ms, gpuMs, spikes, causes, thermal } = digest;
  const why = spikes > 0 && causes.length > 0 ? ` (${causes.join(", ")})` : "";
  const heat = thermal?.batteryC ?? null;
  const parts = [
    path,
    ...(rate === null ? [] : [`@${rate}`]),
    `${Math.round(fps)} fps`,
    `p90 ${msOf(p90Ms)}`,
    `gpu ${msOf(gpuMs)}`,
    `spikes ${spikes}${why}`,
    ...(heat === null ? [] : [`${heat.toFixed(1)} °C`])
  ];
  const lostPart = lost > 0 ? ` · ${groupThousands(lost)} lost` : "";
  return `  ${parts.join("  ")}  · ${groupThousands(lines)} lines${lostPart}`;
}

/**
 * The header lines when this is the log's first event or its engine or build changed.
 *
 * @param event - The event.
 * @param memory - The log's memory (updated).
 * @param name - The phone's name.
 * @param engine - The phone's engine now, or null.
 * @returns The header and REC lines, or none.
 */
function identityLines(
  event: CollectorSessionEvent,
  memory: LiveMemory,
  name: string,
  engine: string | null
): string[] {
  const build = event.last?.build ?? event.device.build;
  const isFirst = memory.state === undefined;
  const engineChanged = engine !== null && engine !== memory.engine;
  const buildChanged = build !== null && build !== memory.build;
  if (!isFirst && !engineChanged && !buildChanged) return [];

  memory.engine = engine ?? memory.engine;
  memory.build = build ?? memory.build;
  return headerLines(event, name, { engine: memory.engine, build: memory.build });
}

/**
 * The STALE line, once per log and engine pair, when both engines are known and differ.
 *
 * @param memory - The log's memory (updated).
 * @param name - The phone's name.
 * @param engine - The phone's engine, or null.
 * @param computerEngine - The computer's engine id.
 * @returns The STALE line, or none.
 */
function staleLines(
  memory: LiveMemory,
  name: string,
  engine: string | null,
  computerEngine: string
): string[] {
  if (!isKnown(engine) || !isKnown(computerEngine) || engine === computerEngine) return [];

  const pair = `${engine}|${computerEngine}`;
  if (memory.staleWarned === pair) return [];
  memory.staleWarned = pair;
  return [
    `${STALE_PREFIX}${name} runs engine ${engine}, this computer has ${computerEngine} · rebuild the game so the logs match`
  ];
}

/**
 * The stats line of a live event: at most every LIVE_EVERY_MS, at once on a new path or rate.
 *
 * @param event - The live event.
 * @param memory - The log's memory (updated).
 * @param now - Computer ms now.
 * @returns The stats line, or none.
 */
function liveLines(event: CollectorSessionEvent, memory: LiveMemory, now: number): string[] {
  const digest = event.last;
  if (digest === null) return [];

  const isDue = now - memory.printedAt >= LIVE_EVERY_MS;
  const moved = digest.path !== memory.path || digest.rate !== memory.rate;
  if (!isDue && !moved) return [];

  memory.printedAt = now;
  memory.path = digest.path;
  memory.rate = digest.rate;
  return [statsLine(digest, event.lines, event.lost)];
}

/**
 * The left or done line, once per change of state.
 *
 * @param event - The away or done event.
 * @param memory - The log's memory (read only).
 * @param name - The phone's name.
 * @returns The line, or none.
 */
function endLines(event: CollectorSessionEvent, memory: LiveMemory, name: string): string[] {
  if (event.state === memory.state) return [];

  const lines = groupThousands(event.lines);
  return event.state === "away"
    ? [`  ○ ${name} left · ${lines} lines kept, the log continues when it comes back`]
    : [`  ■ ${name} · ${lines} lines → ${event.file}`];
}

/**
 * The lines one `collector:session` event prints, given what its log printed before. Updates the
 * memory. The STALE line starts with "STALE: " (`isStaleLine`): the caller prints it as a warning.
 *
 * @param event - The event, its file relative to the root.
 * @param memory - The log's memory (`state.perf.seen`), updated.
 * @param now - Computer ms now.
 * @param computerEngine - `files.engine().id`.
 * @returns The lines, in print order; none when nothing is due.
 * @example
 * ```ts
 * perfLiveLines(event, newLiveMemory(), Date.now(), "0.14.12+9c41e0");
 * // ["◉ SM-A266B · webgpu · engine 0.14.12+9c41e0 · build debug-20261014T160000Z · adb 127.0.0.1",
 * //  "  ● REC → .moku/perf/perf-20261014-1532-sm-a266b.jsonl", "  garden/boss  @60  54 fps  …  · 1 840 lines"]
 * ```
 */
export function perfLiveLines(
  event: CollectorSessionEvent,
  memory: LiveMemory,
  now: number,
  computerEngine: string
): string[] {
  const name = event.device.model ?? "A phone";
  const engine = event.last?.engine ?? event.device.engine;
  const lines = [
    ...identityLines(event, memory, name, engine),
    ...staleLines(memory, name, engine, computerEngine),
    ...(event.state === "live" ? liveLines(event, memory, now) : endLines(event, memory, name))
  ];
  memory.state = event.state;
  return lines;
}
