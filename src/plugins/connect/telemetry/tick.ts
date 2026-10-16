/**
 * @file connect plugin — one telemetry tick of a probed attach (spec 11 C6): one `head -n 1` (A5)
 * over /proc/stat, the three processes' stat and the GPU nodes; CPU from the deltas against the
 * tick before; GPU; the CDP heap samples since the tick before with their inferred GCs; the last
 * meminfo readings. The record is published as `editor.deviceTelemetry` and emitted as
 * `connect:telemetry`. Every reading names its source and degrades alone. A process whose stat is
 * missing two ticks in a row makes the next tick re-probe (and CDP re-attach). Every
 * `meminfoEveryMs`, `dumpsys meminfo` (A8) for the app and the renderer, one after the other.
 */
import { hubPlugin } from "../../hub";
import { detachCdp } from "../cdp/attach";
import { takeHeap } from "../cdp/heap";
import { freezeDeep } from "../shared";
import type {
  AttachRecord,
  ConnectCtx,
  CpuCounters,
  DeviceTelemetry,
  HeadRead,
  Probe,
  ProcessCpu,
  ProcessFind,
  ProcessMemory,
  ProcessRole,
  Reading
} from "../types";
import { parseHeadSections } from "../wire/parse";
import { adb } from "../wire/run";
import { cpuShare, parseCpuTotal, parseProcStat } from "./cpu";
import { parseGpu } from "./gpu";
import { parseMeminfo } from "./meminfo";

/** The three processes, in the order of the tick's paths. */
const ROLES: readonly ProcessRole[] = ["app", "renderer", "surfaceflinger"];

/** Ticks in a row a process's stat may be missing before the attach re-probes. */
const MISSING_TICKS = 2;

/** The source of the memory readings. */
const MEMINFO = "dumpsys meminfo";

/** What a tick ended with: done, or adb is not on this computer any more. */
export type TickEnd = "done" | "adb-missing";

/**
 * The stat file of a process.
 *
 * @param pid - The pid.
 * @returns Its path.
 * @example
 * ```ts
 * statPath(23811); // "/proc/23811/stat"
 * ```
 */
function statPath(pid: number): string {
  return `/proc/${pid}/stat`;
}

/**
 * The paths one tick reads: /proc/stat, each found process's stat, the GPU nodes.
 *
 * @param probe - The probe.
 * @returns The paths (at most 1 + 3 + 4).
 */
function tickPaths(probe: Probe): string[] {
  const stats = ROLES.flatMap(role => {
    const find = probe[role];
    return find.found ? [statPath(find.pid)] : [];
  });
  return ["/proc/stat", ...stats, ...probe.gpu.map(node => node.path)];
}

/**
 * The CPU counters of a tick: the total of /proc/stat and `utime + stime` of each found process.
 *
 * @param read - The tick's head.
 * @param probe - The probe.
 * @returns The counters, or undefined without /proc/stat.
 */
function countersOf(read: HeadRead, probe: Probe): CpuCounters | undefined {
  const total = parseCpuTotal(read.sections.get("/proc/stat") ?? "");
  if (total === undefined) return undefined;
  const ticks = new Map<number, number>();
  for (const role of ROLES) {
    const find = probe[role];
    if (!find.found) continue;
    const stat = parseProcStat(read.sections.get(statPath(find.pid)) ?? "");
    if (stat?.pid === find.pid) ticks.set(find.pid, stat.utime + stat.stime);
  }
  return { total, ticks };
}

/**
 * The CPU reading of one process.
 *
 * @param attach - The attach (the counters of the tick before).
 * @param after - The counters of this tick.
 * @param find - The process.
 * @param cores - The phone's cores.
 * @returns The reading, its source the process's stat.
 */
function cpuOf(
  attach: AttachRecord,
  after: CpuCounters | undefined,
  find: ProcessFind,
  cores: number | null
): Reading<ProcessCpu> {
  if (!find.found) return { available: false, source: "none", reason: find.reason };
  const source = statPath(find.pid);
  const share =
    after === undefined ? "unreadable" : cpuShare(attach.counters, after, find.pid, cores ?? 1);
  if (typeof share === "string") return { available: false, source, reason: share };
  return { available: true, source, value: { pid: find.pid, name: find.name, ...share } };
}

/**
 * Counts the ticks each found process's stat was missing; at two in a row the attach is
 * re-probed on the next tick and CDP detaches (it re-attaches with the probe).
 *
 * @param ctx - Domain context of connect.
 * @param attach - The attach.
 * @param read - The tick's head.
 * @param probe - The probe of this tick.
 */
function noteMissing(ctx: ConnectCtx, attach: AttachRecord, read: HeadRead, probe: Probe): void {
  let vanished = false;
  for (const role of ROLES) {
    const find = probe[role];
    if (!find.found) continue;
    const count = read.sections.has(statPath(find.pid)) ? 0 : (attach.missing.get(role) ?? 0) + 1;
    attach.missing.set(role, count);
    if (count >= MISSING_TICKS) vanished = true;
  }
  if (!vanished) return;
  attach.probe = undefined;
  attach.missing.clear();
  void detachCdp(ctx, attach);
}

/**
 * Reads one tick, publishes its record and emits it.
 *
 * @param ctx - Domain context of connect.
 * @param attach - The attach.
 * @param probe - Its probe.
 * @returns "adb-missing" when adb could not run, else "done".
 */
export async function readTick(
  ctx: ConnectCtx,
  attach: AttachRecord,
  probe: Probe
): Promise<TickEnd> {
  const paths = tickPaths(probe);
  const result = await adb(ctx, { kind: "head", serial: attach.serial, lines: 1, paths });
  if (result.missing) return "adb-missing";
  if (attach.ended) return "done";

  const read = parseHeadSections(result.text, paths);
  const counters = countersOf(read, probe);
  const cpu = {
    cores: probe.cores,
    app: cpuOf(attach, counters, probe.app, probe.cores),
    renderer: cpuOf(attach, counters, probe.renderer, probe.cores),
    surfaceflinger: cpuOf(attach, counters, probe.surfaceflinger, probe.cores)
  };
  attach.counters = counters;
  noteMissing(ctx, attach, read, probe);

  const record: DeviceTelemetry = freezeDeep({
    v: 1,
    device: attach.device,
    serial: attach.serial,
    at: Date.now(),
    wired: true,
    gpu: parseGpu(read, probe.gpu),
    cpu,
    memory: { ...attach.memory },
    heap: takeHeap(attach, ctx.config.gcDropMb)
  });
  attach.last = record;
  ctx.require(hubPlugin).publish("deviceTelemetry", record);
  ctx.emit("connect:telemetry", record);
  return "done";
}

/**
 * The memory reading of one process.
 *
 * @param ctx - Domain context of connect.
 * @param attach - The attach.
 * @param find - The process.
 * @returns The reading.
 */
async function memoryOf(
  ctx: ConnectCtx,
  attach: AttachRecord,
  find: ProcessFind
): Promise<Reading<ProcessMemory>> {
  if (!find.found) return { available: false, source: "none", reason: find.reason };
  const result = await adb(ctx, { kind: "meminfo", serial: attach.serial, pid: find.pid });
  if (result.code !== 0 && result.text.trim() === "") {
    return { available: false, source: MEMINFO, reason: result.missing ? "adb-missing" : "error" };
  }
  const memory = parseMeminfo(result.text, find.pid, Date.now());
  return typeof memory === "string"
    ? { available: false, source: MEMINFO, reason: memory }
    : { available: true, source: MEMINFO, value: memory };
}

/**
 * Reads `dumpsys meminfo` of the app and the renderer when `meminfoEveryMs` passed since the last
 * round; the next records carry them.
 *
 * @param ctx - Domain context of connect.
 * @param attach - The attach.
 * @param probe - Its probe.
 * @returns When the round is over or not due.
 */
export async function readMemory(
  ctx: ConnectCtx,
  attach: AttachRecord,
  probe: Probe
): Promise<void> {
  const now = Date.now();
  if (now - attach.memoryAt < ctx.config.meminfoEveryMs) return;
  attach.memoryAt = now;
  const app = await memoryOf(ctx, attach, probe.app);
  if (attach.ended) return;
  const renderer = await memoryOf(ctx, attach, probe.renderer);
  if (!attach.ended) attach.memory = { app, renderer };
}
