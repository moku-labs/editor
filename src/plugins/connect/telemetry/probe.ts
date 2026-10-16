/**
 * @file connect plugin — the probe of a wired phone, once per attach and again after a process
 * vanished (spec 11 C6): the devtools sockets (A3), the processes (A4), the cores (A5 of
 * /proc/stat), the GPU nodes (A5 of the table, else A6 + A5 of a devfreq GPU) and the start times
 * of the app candidates and the sandboxed processes (A5). `resolveProbe` then picks the three
 * processes: the app (the non-sandboxed process of a WebView devtools socket; several → the one CDP
 * matched), its WebView renderer (the sandboxed process started closest after the app; another
 * within 2 s → ambiguous) and surfaceflinger.
 */

import type {
  AdbCommand,
  AttachRecord,
  ConnectCore,
  GpuNode,
  Probe,
  ProcessFind,
  PsProcess
} from "../types";
import { MAX_HEAD_PATHS } from "../wire/command";
import { parseHeadSections, parsePs, parseUnixSockets } from "../wire/parse";
import { adb } from "../wire/run";
import { countCores, parseProcStat } from "./cpu";
import { devfreqNodeOf, GPU_NODES, gpuDevfreqNames, pickGpuNodes } from "./gpu";

/** Clock ticks per second of /proc (USER_HZ on Android). */
const TICKS_PER_S = 100;

/** Two renderers started within this many ticks of each other are ambiguous (2 s). */
const AMBIGUOUS_TICKS = 2 * TICKS_PER_S;

/** The pid in a WebView devtools socket name. */
const SOCKET_PID = /^webview_devtools_remote_(\d+)$/;

/** What the adb calls of a probe found, before the processes are picked. */
export type ProbeFound = {
  readonly cores: number | null;
  readonly gpu: readonly GpuNode[];
  /** The devtools sockets CDP tries, in order: the app candidates' WebView sockets, then Chrome's. */
  readonly sockets: readonly string[];
  /** The pids of the app candidates. */
  readonly apps: readonly number[];
  readonly processes: readonly PsProcess[];
  /** Start times (field 22) by pid. */
  readonly starts: ReadonlyMap<number, number>;
};

/**
 * The pid in a WebView devtools socket name.
 *
 * @param socket - The socket name.
 * @returns The pid, or undefined for Chrome's socket.
 * @example
 * ```ts
 * socketPid("webview_devtools_remote_23811"); // 23811
 * ```
 */
export function socketPid(socket: string | undefined): number | undefined {
  const digits = SOCKET_PID.exec(socket ?? "")?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/**
 * Whether a process is a sandboxed (renderer) process.
 *
 * @param name - The process name.
 * @returns True for a sandboxed process.
 * @example
 * ```ts
 * isSandboxed("com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0"); // true
 * ```
 */
function isSandboxed(name: string): boolean {
  return name.includes(":sandboxed_process");
}

/**
 * The output of one adb call of the probe, or undefined when the attach ended meanwhile.
 *
 * @param ctx - The config and the state.
 * @param attach - The attach.
 * @param command - The command.
 * @returns What adb printed.
 */
async function textOf(
  ctx: ConnectCore,
  attach: AttachRecord,
  command: AdbCommand
): Promise<string | undefined> {
  const result = await adb(ctx, command);
  return attach.ended ? undefined : result.text;
}

/**
 * The first lines of files, in calls of at most 12 paths.
 *
 * @param ctx - The config and the state.
 * @param attach - The attach.
 * @param paths - The files.
 * @returns Each file's text by path, or undefined when the attach ended.
 */
async function firstLines(
  ctx: ConnectCore,
  attach: AttachRecord,
  paths: readonly string[]
): Promise<Map<string, string> | undefined> {
  const found = new Map<string, string>();
  for (let index = 0; index < paths.length; index += MAX_HEAD_PATHS) {
    const chunk = paths.slice(index, index + MAX_HEAD_PATHS);
    const text = await textOf(ctx, attach, {
      kind: "head",
      serial: attach.serial,
      lines: 1,
      paths: chunk
    });
    if (text === undefined) return undefined;
    for (const [file, body] of parseHeadSections(text, chunk).sections) found.set(file, body);
  }
  return found;
}

/**
 * The GPU nodes of a phone: the table's nodes that answer, else the clock of a devfreq GPU.
 *
 * @param ctx - The config and the state.
 * @param attach - The attach.
 * @returns The nodes the ticks read ([] when none answered), or undefined when the attach ended.
 */
async function probeGpu(ctx: ConnectCore, attach: AttachRecord): Promise<GpuNode[] | undefined> {
  const table = await firstLines(
    ctx,
    attach,
    GPU_NODES.map(node => node.path)
  );
  if (table === undefined) return undefined;
  const nodes = pickGpuNodes({ sections: table, denied: new Set() });
  if (nodes.length > 0) return nodes;

  const listing = await textOf(ctx, attach, { kind: "devfreq", serial: attach.serial });
  if (listing === undefined) return undefined;
  const candidates = gpuDevfreqNames(listing)
    .slice(0, MAX_HEAD_PATHS)
    .map(name => devfreqNodeOf(name));
  if (candidates.length === 0) return [];
  const clocks = await firstLines(
    ctx,
    attach,
    candidates.map(node => node.path)
  );
  return clocks === undefined
    ? undefined
    : pickGpuNodes({ sections: clocks, denied: new Set() }, candidates);
}

/**
 * The start times of processes (field 22 of their stat).
 *
 * @param ctx - The config and the state.
 * @param attach - The attach.
 * @param pids - The processes.
 * @returns Start by pid, or undefined when the attach ended.
 */
async function startsOf(
  ctx: ConnectCore,
  attach: AttachRecord,
  pids: readonly number[]
): Promise<Map<number, number> | undefined> {
  const lines = await firstLines(
    ctx,
    attach,
    pids.map(pid => `/proc/${pid}/stat`)
  );
  if (lines === undefined) return undefined;
  const starts = new Map<number, number>();
  for (const line of lines.values()) {
    const stat = parseProcStat(line);
    if (stat !== undefined) starts.set(stat.pid, stat.start);
  }
  return starts;
}

/**
 * Probes a wired phone. At most one adb call is in flight; the probe stops when the attach ends.
 *
 * @param ctx - The config and the state.
 * @param attach - The attach.
 * @returns What it found, or undefined when the attach ended.
 */
export async function probeDevice(
  ctx: ConnectCore,
  attach: AttachRecord
): Promise<ProbeFound | undefined> {
  const { serial } = attach;
  const unix = await textOf(ctx, attach, { kind: "unix-sockets", serial });
  const ps =
    unix === undefined ? undefined : await textOf(ctx, attach, { kind: "processes", serial });
  const stat =
    ps === undefined
      ? undefined
      : await textOf(ctx, attach, { kind: "head", serial, lines: 64, paths: ["/proc/stat"] });
  const gpu = stat === undefined ? undefined : await probeGpu(ctx, attach);
  if (unix === undefined || ps === undefined || stat === undefined || gpu === undefined)
    return undefined;

  const processes = parsePs(ps);
  const names = new Map(processes.map(process => [process.pid, process.name]));
  const sockets = parseUnixSockets(unix);
  const apps = sockets
    .map(socket => socketPid(socket))
    .filter((pid): pid is number => {
      const name = pid === undefined ? undefined : names.get(pid);
      return name !== undefined && !isSandboxed(name);
    });
  const sandboxed = processes
    .filter(process => isSandboxed(process.name))
    .map(process => process.pid);
  const starts = await startsOf(ctx, attach, [...apps, ...sandboxed]);
  if (starts === undefined) return undefined;

  const ordered = [
    ...sockets.filter(socket => apps.includes(socketPid(socket) ?? -1)),
    ...sockets.filter(socket => socketPid(socket) === undefined)
  ];
  return { cores: countCores(stat), gpu, sockets: ordered, apps, processes, starts };
}

/**
 * A found process.
 *
 * @param process - The process.
 * @returns The ProcessFind.
 */
function found(process: PsProcess): ProcessFind {
  return { found: true, pid: process.pid, name: process.name };
}

/**
 * The app: the pid CDP matched, else the only candidate; none → not-found, several → ambiguous.
 *
 * @param probe - What the probe found.
 * @param matched - The pid of the socket CDP attached to, if any.
 * @returns The app.
 */
function appOf(probe: ProbeFound, matched: number | undefined): ProcessFind {
  const pid = matched ?? (probe.apps.length === 1 ? probe.apps[0] : undefined);
  const process = probe.processes.find(item => item.pid === pid);
  if (process !== undefined) return found(process);
  return { found: false, reason: probe.apps.length > 1 ? "ambiguous" : "not-found" };
}

/**
 * The app's WebView renderer: the sandboxed process started at or after the app, the closest;
 * another started within 2 s of it → ambiguous.
 *
 * @param probe - What the probe found.
 * @param app - The app.
 * @returns The renderer.
 */
function rendererOf(probe: ProbeFound, app: ProcessFind): ProcessFind {
  if (!app.found) return { found: false, reason: app.reason };
  const appStart = probe.starts.get(app.pid);
  if (appStart === undefined) return { found: false, reason: "not-found" };

  const after = probe.processes
    .filter(process => isSandboxed(process.name))
    .map(process => ({ process, start: probe.starts.get(process.pid) ?? -1 }))
    .filter(item => item.start >= appStart)
    .toSorted((left, right) => left.start - right.start);
  const [best, next] = after;
  if (best === undefined) return { found: false, reason: "not-found" };
  if (next !== undefined && next.start - best.start <= AMBIGUOUS_TICKS) {
    return { found: false, reason: "ambiguous" };
  }
  return found(best.process);
}

/**
 * Picks the three processes of what the probe found.
 *
 * @param probe - What the probe found.
 * @param socket - The devtools socket CDP attached to, if any (it names the app among several).
 * @returns The probe the ticks read.
 * @example
 * ```ts
 * resolveProbe({ cores: 8, gpu: [], sockets: [], apps: [], processes: [{ pid: 612, name: "surfaceflinger" }], starts: new Map() }, undefined).surfaceflinger; // { found: true, pid: 612, name: "surfaceflinger" }
 * ```
 */
export function resolveProbe(probe: ProbeFound, socket: string | undefined): Probe {
  const app = appOf(probe, socketPid(socket));
  const flinger = probe.processes.find(process => process.name === "surfaceflinger");
  return {
    cores: probe.cores,
    app,
    renderer: rendererOf(probe, app),
    surfaceflinger: flinger === undefined ? { found: false, reason: "not-found" } : found(flinger),
    gpu: probe.gpu
  };
}
