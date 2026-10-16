/* eslint-disable unicorn/no-null -- null is "not reported" on the collector's thermal line */
/**
 * @file collector plugin — the adb loop while device mode is on: a reverse round every
 * `reverseEveryMs` (`adb devices`, the model of a new serial, `adb reverse` for every ready phone)
 * and a poll round every `everyS` (heat and system frames of each phone matched to exactly one live
 * adb log of the configured app), written as collector lines through the log's queue. A round
 * already running when the loop stops finishes and writes nothing. adb missing stops the loop until
 * device mode turns on again.
 */
import { baseAppId } from "../../hub/protocol";
import type { PerfCollectorLine, PerfThermalLine } from "../../perf/protocol";
import { pageTime } from "../session/clock";
import { readLine } from "../session/digest";
import { enqueue } from "../session/writer";
import type {
  AdbLoop,
  AdbPhone,
  AdbResult,
  AdbRunner,
  CollectorCtx,
  CollectorState,
  GfxSpan,
  GfxTotals,
  LogSession
} from "../types";
import {
  parseBattery,
  parseDevices,
  parseGfx,
  parseModel,
  parsePackages,
  parseThermal,
  roundTenth,
  spanOf
} from "./parse";
import { runAdb } from "./run";

/** How long a resolved app package is trusted before `pm list packages` runs again, ms. */
const PACKAGE_TTL_MS = 60_000;

/** Milliseconds of a second. */
const SECOND_MS = 1000;

/** The hint of the one `collector:adb-missing` line. */
const MISSING_HINT =
  "USB phones need Android platform-tools (adb) on PATH; a LAN phone works without it";

/** A collector line with the computer clock it was written at. */
type Stamped<Line> = Line & { readonly rx: number };

/**
 * Whether a loop is still the running one: a round checks it before each write.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The round's loop.
 * @returns Whether the round may write.
 */
function isCurrent(ctx: CollectorCtx, loop: AdbLoop): boolean {
  return ctx.state.adb === loop && loop.state === "on";
}

/**
 * Stops a loop whose adb cannot be spawned: both timers cleared, one info line. It does not retry
 * until device mode turns on again.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 */
function markMissing(ctx: CollectorCtx, loop: AdbLoop): void {
  if (loop.state === "missing") return;

  loop.state = "missing";
  clearInterval(loop.reverseTimer);
  clearInterval(loop.pollTimer);
  ctx.log.info("collector:adb-missing", { hint: MISSING_HINT });
}

/**
 * Runs one adb command with the configured command and timeout; a missing adb stops the loop.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param run - The process seam.
 * @param args - The arguments.
 * @returns What the command answered.
 */
async function adbOf(
  ctx: CollectorCtx,
  loop: AdbLoop,
  run: AdbRunner,
  args: readonly string[]
): Promise<AdbResult> {
  const result = await run(ctx.config.adb, args, ctx.config.adbTimeoutMs);
  if (result.missing) markMissing(ctx, loop);
  return result;
}

/**
 * Forgets the phones that left `adb devices`, with their warnings.
 *
 * @param loop - The loop.
 * @param serials - The ready serials now.
 */
function forgetGone(loop: AdbLoop, serials: readonly string[]): void {
  const ready = new Set(serials);
  for (const serial of loop.phones.keys()) {
    if (ready.has(serial)) continue;
    loop.phones.delete(serial);
    loop.warned.delete(`reverse:${serial}`);
  }
}

/**
 * Notes a reverse's outcome: the first success of an appearance is logged, a failure warns once
 * per serial until it succeeds.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param phone - The phone.
 * @param reversed - Whether `adb reverse` succeeded.
 */
function noteReverse(ctx: CollectorCtx, loop: AdbLoop, phone: AdbPhone, reversed: boolean): void {
  const key = `reverse:${phone.serial}`;
  const { serial, model } = phone;
  if (reversed) {
    if (!phone.reversed) ctx.log.info("collector:reversed", { serial, model, port: loop.port });
    phone.reversed = true;
    loop.warned.delete(key);
    return;
  }

  phone.reversed = false;
  if (loop.warned.has(key)) return;
  loop.warned.add(key);
  ctx.log.warn("collector:reverse-failed", { serial, model });
}

/**
 * Reverses the device port for one ready phone; a serial seen for the first time reads its model
 * once.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param run - The process seam.
 * @param serial - The phone's serial.
 */
async function reversePhone(
  ctx: CollectorCtx,
  loop: AdbLoop,
  run: AdbRunner,
  serial: string
): Promise<void> {
  let phone = loop.phones.get(serial);
  if (phone === undefined) {
    phone = { serial, model: null, reversed: false, package: undefined, gfx: undefined };
    loop.phones.set(serial, phone);
    const property = await adbOf(ctx, loop, run, [
      "-s",
      serial,
      "shell",
      "getprop",
      "ro.product.model"
    ]);
    if (property.code === 0) phone.model = parseModel(property.text);
  }

  const port = `tcp:${loop.port}`;
  const reversed = await adbOf(ctx, loop, run, ["-s", serial, "reverse", port, port]);
  if (isCurrent(ctx, loop)) noteReverse(ctx, loop, phone, reversed.code === 0);
}

/**
 * One reverse round (skipped while one runs): `adb devices`, then `adb reverse` for every ready
 * phone, a phone plugged in later included. A serial that left is forgotten.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param run - The process seam.
 * @returns When the round is over.
 */
export async function reverseRound(
  ctx: CollectorCtx,
  loop: AdbLoop,
  run: AdbRunner
): Promise<void> {
  if (loop.reversing || !isCurrent(ctx, loop)) return;

  loop.reversing = true;
  try {
    const listed = await adbOf(ctx, loop, run, ["devices"]);
    if (!isCurrent(ctx, loop) || listed.code !== 0) return;

    const serials = parseDevices(listed.text);
    forgetGone(loop, serials);
    await Promise.all(serials.map(serial => reversePhone(ctx, loop, run, serial)));
  } finally {
    loop.reversing = false;
  }
}

/**
 * Items grouped by model; an item without a model is left out.
 *
 * @param items - The items.
 * @param modelOf - The model of an item.
 * @returns The groups.
 */
function byModel<Item>(
  items: Iterable<Item>,
  modelOf: (item: Item) => string | null
): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const model = modelOf(item);
    if (model === null) continue;

    const group = groups.get(model);
    if (group === undefined) groups.set(model, [item]);
    else group.push(item);
  }

  return groups;
}

/**
 * The single item of a list.
 *
 * @param items - The list.
 * @returns Its item when it has exactly one.
 * @example
 * ```ts
 * only(["a", "b"]); // undefined
 * ```
 */
function only<Item>(items: readonly Item[]): Item | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/**
 * Whether a log is of the configured app: its app id (the pair's, the header's `app.id`) equals
 * `appId` once a trailing `.debug` is stripped. A log without an app id (an engine before it) and
 * a collector without `appId` keep every log.
 *
 * @param session - The log.
 * @param appId - `collector.appId`.
 * @returns Whether the log may be matched to a phone.
 */
function isOwnApp(session: LogSession, appId: string | undefined): boolean {
  const logApp = session.device.appId;
  return logApp === undefined || appId === undefined || baseAppId(logApp) === baseAppId(appId);
}

/**
 * The phones matched to a log: exactly one phone and one live adb log of the configured app
 * (`isOwnApp`) of a model. Several of either write nothing for that model and log
 * `collector:adb-ambiguous` once.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @returns The pairs of phone and log.
 */
function matchesOf(ctx: CollectorCtx, loop: AdbLoop): [AdbPhone, LogSession][] {
  const live = [...ctx.state.sessions.values()].filter(
    session =>
      session.state === "live" &&
      session.device.link === "adb" &&
      isOwnApp(session, ctx.config.appId)
  );
  const logs = byModel(live, session => session.model);
  const matches: [AdbPhone, LogSession][] = [];

  for (const [model, phones] of byModel(loop.phones.values(), phone => phone.model)) {
    const sessions = logs.get(model);
    if (sessions === undefined) continue;

    const phone = only(phones);
    const session = only(sessions);
    if (phone !== undefined && session !== undefined) matches.push([phone, session]);
    else if (!loop.warned.has(`ambiguous:${model}`)) {
      loop.warned.add(`ambiguous:${model}`);
      ctx.log.info("collector:adb-ambiguous", { model });
    }
  }

  return matches;
}

/**
 * The game's package on a phone (cached 60 s); null without `appId` or when it is not installed.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param run - The process seam.
 * @param phone - The phone.
 * @returns The package name, or null.
 */
async function packageOf(
  ctx: CollectorCtx,
  loop: AdbLoop,
  run: AdbRunner,
  phone: AdbPhone
): Promise<string | null> {
  const { appId } = ctx.config;
  if (appId === undefined) return null;

  const now = Date.now();
  if (phone.package !== undefined && now - phone.package.at < PACKAGE_TTL_MS)
    return phone.package.name;

  const listed = await adbOf(ctx, loop, run, [
    "-s",
    phone.serial,
    "shell",
    "pm",
    "list",
    "packages",
    appId
  ]);
  const name = listed.code === 0 ? parsePackages(listed.text, appId) : null;
  phone.package = { name, at: now };
  return name;
}

/**
 * The app's gfxinfo totals on a phone, or undefined without a package or while the app does not
 * run.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param run - The process seam.
 * @param phone - The phone.
 * @returns The totals, or undefined.
 */
async function gfxOf(
  ctx: CollectorCtx,
  loop: AdbLoop,
  run: AdbRunner,
  phone: AdbPhone
): Promise<GfxTotals | undefined> {
  const name = await packageOf(ctx, loop, run, phone);
  if (name === null) return undefined;

  const answer = await adbOf(ctx, loop, run, [
    "-s",
    phone.serial,
    "shell",
    "dumpsys",
    "gfxinfo",
    name
  ]);
  return answer.code === 0 ? parseGfx(answer.text) : undefined;
}

/**
 * The frames since the phone's previous gfxinfo reading, which this reading replaces. The first
 * reading (and one after the app stopped) is only the baseline.
 *
 * @param phone - The phone.
 * @param totals - This reading, or undefined.
 * @param now - Computer ms of this reading.
 * @returns The span with its seconds, or undefined for a baseline.
 */
function gfxSpanOf(
  phone: AdbPhone,
  totals: GfxTotals | undefined,
  now: number
): (GfxSpan & { readonly seconds: number }) | undefined {
  const before = phone.gfx;
  phone.gfx = totals === undefined ? undefined : { totals, at: now };
  if (totals === undefined || before === undefined) return undefined;

  const seconds = roundTenth((now - before.at) / SECOND_MS);
  return { ...spanOf(before.totals, totals, seconds), seconds };
}

/**
 * The thermal line of a poll (`source: "collector"`), on the log's page clock.
 *
 * @param session - The log.
 * @param t - Page t of the poll.
 * @param rx - Computer ms of the poll.
 * @param battery - What `dumpsys battery` answered.
 * @param thermal - What `dumpsys thermalservice` answered.
 * @returns The line.
 */
function thermalLineOf(
  session: LogSession,
  t: number,
  rx: number,
  battery: AdbResult,
  thermal: AdbResult
): Stamped<PerfThermalLine> {
  const heat = thermal.code === 0 ? parseThermal(thermal.text) : { status: null, sensors: null };
  return {
    v: 1,
    kind: "thermal",
    t,
    build: session.build,
    rx,
    source: "collector",
    device: session.model,
    status: heat.status,
    headroom: null,
    at: t,
    android: { status: heat.status, headroom: null, forecastSeconds: null },
    batteryC: battery.code === 0 ? parseBattery(battery.text) : null,
    sensors: heat.sensors
  };
}

/**
 * The gfx line of a poll, on the log's page clock.
 *
 * @param session - The log.
 * @param t - Page t of the poll.
 * @param rx - Computer ms of the poll.
 * @param span - The frames since the previous reading.
 * @returns The line.
 */
function gfxLineOf(
  session: LogSession,
  t: number,
  rx: number,
  span: GfxSpan & { readonly seconds: number }
): Stamped<PerfCollectorLine> {
  const { seconds, frames, janky, fps, p50, p90, p99 } = span;
  return {
    v: 1,
    kind: "gfx",
    t,
    build: session.build,
    rx,
    device: session.model,
    seconds,
    frames,
    janky,
    fps,
    p50,
    p90,
    p99,
    hist: Object.fromEntries(span.hist.map(([ms, count]) => [String(ms), count]))
  };
}

/**
 * Writes a collector line through the log's queue and lets the digest read it.
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @param line - The line.
 */
function writeLine(
  ctx: CollectorCtx,
  session: LogSession,
  line: Stamped<PerfThermalLine> | Stamped<PerfCollectorLine>
): void {
  readLine(session, line);
  void enqueue(ctx, session, `${JSON.stringify(line)}\n`, 1);
}

/**
 * Polls one matched phone: battery, thermal service and gfxinfo in parallel, then a thermal line
 * and, from the second gfx reading on, a gfx line, unless the loop stopped or the log left.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param run - The process seam.
 * @param match - The phone and its log.
 */
async function pollPhone(
  ctx: CollectorCtx,
  loop: AdbLoop,
  run: AdbRunner,
  match: readonly [AdbPhone, LogSession]
): Promise<void> {
  const [phone, session] = match;
  const shell = (command: readonly string[]) =>
    adbOf(ctx, loop, run, ["-s", phone.serial, "shell", ...command]);
  const [battery, thermal, totals] = await Promise.all([
    shell(["dumpsys", "battery"]),
    shell(["dumpsys", "thermalservice"]),
    gfxOf(ctx, loop, run, phone)
  ]);
  if (!isCurrent(ctx, loop) || session.state !== "live") return;

  const now = Date.now();
  const t = pageTime(session.offset, now);
  if (battery.code === 0 || thermal.code === 0) {
    writeLine(ctx, session, thermalLineOf(session, t, now, battery, thermal));
  }
  const span = gfxSpanOf(phone, totals, now);
  if (span !== undefined) writeLine(ctx, session, gfxLineOf(session, t, now, span));
}

/**
 * One poll round (skipped while one runs): every phone matched to exactly one live adb log is
 * polled in parallel.
 *
 * @param ctx - Domain context of the collector.
 * @param loop - The loop.
 * @param run - The process seam.
 * @returns When the round is over.
 */
export async function pollRound(ctx: CollectorCtx, loop: AdbLoop, run: AdbRunner): Promise<void> {
  if (loop.polling || !isCurrent(ctx, loop)) return;

  loop.polling = true;
  try {
    await Promise.all(matchesOf(ctx, loop).map(match => pollPhone(ctx, loop, run, match)));
  } finally {
    loop.polling = false;
  }
}

/**
 * The adb loop with both timers (unref'd): a reverse round every `reverseEveryMs`, a poll round
 * every `everyS` s.
 *
 * @param ctx - Domain context of the collector.
 * @param port - The device port to reverse.
 * @param run - The process seam.
 * @returns The loop (not yet the state's).
 */
export function createAdbLoop(ctx: CollectorCtx, port: number, run: AdbRunner): AdbLoop {
  const loop: AdbLoop = {
    port,
    phones: new Map(),
    reversing: false,
    polling: false,
    state: "on",
    warned: new Set(),
    reverseTimer: setInterval(() => {
      void reverseRound(ctx, loop, run);
    }, ctx.config.reverseEveryMs),
    pollTimer: setInterval(() => {
      void pollRound(ctx, loop, run);
    }, ctx.config.everyS * SECOND_MS)
  };
  loop.reverseTimer.unref();
  loop.pollTimer.unref();
  return loop;
}

/**
 * Turns the adb loop on for device mode's port (a running loop is stopped first): a reverse
 * round and a poll round at once (the first poll records the gfx baseline), then on their timers.
 *
 * @param ctx - Domain context of the collector.
 * @param port - The device port to reverse.
 * @param run - The process seam (`runAdb` by default).
 * @returns The loop, now `state.adb`.
 */
export function startAdbLoop(ctx: CollectorCtx, port: number, run: AdbRunner = runAdb): AdbLoop {
  stopAdbLoop(ctx);
  const loop = createAdbLoop(ctx, port, run);
  ctx.state.adb = loop;
  void reverseRound(ctx, loop, run);
  void pollRound(ctx, loop, run);
  return loop;
}

/**
 * Turns the adb loop off: both timers cleared, `state.adb` undefined. A round already running
 * finishes and writes nothing. Takes the state only, so onStop can call it.
 *
 * @param ctx - Anything with the collector's state.
 * @param ctx.state - The collector's state.
 */
export function stopAdbLoop(ctx: { readonly state: CollectorState }): void {
  const loop = ctx.state.adb;
  if (loop === undefined) return;

  clearInterval(loop.reverseTimer);
  clearInterval(loop.pollTimer);
  ctx.state.adb = undefined;
}
