/**
 * @file connect plugin — the telemetry loop (spec 11 C6): watches and their leases per tools
 * connection, the attach of a watched, wired, linked device (a 1 Hz tick and a 4 Hz heap sampler,
 * both unref'd), the probe on the first tick and after a process vanished, and the detach when no
 * lease holds the device any more, the device left, or device mode stopped. At most one adb call
 * per attach is in flight: a slow phone skips a tick, never queues one.
 */
import { hubPlugin } from "../../hub";
import { attachCdp, detachCdp } from "../cdp/attach";
import { sampleHeap } from "../cdp/heap";
import { currentDirectory } from "../directory";
import { unref } from "../shared";
import { createAttachRecord } from "../state";
import type { AttachRecord, ConnectCore, ConnectCtx, ConnectState, WatchAnswer } from "../types";
import { probeDevice, resolveProbe } from "./probe";
import { readMemory, readTick } from "./tick";

/** An iPhone or iPad model as the hub normalizes it. */
const APPLE_MODEL = /^(?:IPHONE|IPAD)/;

/**
 * When the last lease of a device ends.
 *
 * @param state - The state.
 * @param device - The device id.
 * @returns Epoch ms; 0 without a lease.
 */
export function leaseEnd(state: ConnectState, device: string): number {
  const leases = state.watches.get(device);
  return leases === undefined ? 0 : Math.max(0, ...leases.values());
}

/**
 * Ends an attach: no step goes on, both timers stop. The CDP link and its forward are the
 * caller's to give back.
 *
 * @param attach - The attach.
 */
export function closeAttach(attach: AttachRecord): void {
  attach.ended = true;
  clearInterval(attach.timers.tick);
  clearInterval(attach.timers.heap);
  attach.timers = { tick: undefined, heap: undefined };
}

/**
 * Detaches a device's telemetry: the attach ends, its CDP socket closes and its forward is
 * removed (in the background). The leases stay: a watch that comes again attaches again.
 *
 * @param ctx - The config and the state.
 * @param device - The device id.
 */
export function detachDevice(ctx: ConnectCore, device: string): void {
  const attach = ctx.state.attaches.get(device);
  if (attach === undefined) return;
  ctx.state.attaches.delete(device);
  closeAttach(attach);
  void detachCdp(ctx, attach);
}

/**
 * The first tick of an attach and the one after a process vanished: probe, attach CDP, pick the
 * processes. The CPU counters start over.
 *
 * @param ctx - Domain context of connect.
 * @param attach - The attach.
 * @returns When the probe is done or the attach ended.
 */
async function probeAttach(ctx: ConnectCtx, attach: AttachRecord): Promise<void> {
  const found = await probeDevice(ctx, attach);
  if (found === undefined) return;
  const socket = await attachCdp(ctx, attach, found.sockets, () => {
    void detachCdp(ctx, attach);
    attach.probe = undefined;
  });
  if (attach.ended) return;
  attach.probe = resolveProbe(found, socket);
  attach.counters = undefined;
  attach.missing.clear();
}

/**
 * One tick of an attach: the lease first (an attach no lease holds is detached), then — unless an
 * adb call is still in flight — the probe or the reading of the tick and, when due, meminfo.
 *
 * @param ctx - Domain context of connect.
 * @param attach - The attach.
 * @returns When the tick is over.
 */
export async function tick(ctx: ConnectCtx, attach: AttachRecord): Promise<void> {
  const { state } = ctx;
  if (attach.ended || state.stopped) return;
  if (Date.now() >= leaseEnd(state, attach.device)) {
    state.watches.delete(attach.device);
    detachDevice(ctx, attach.device);
    return;
  }
  if (attach.busy) return;

  attach.busy = true;
  try {
    const { probe } = attach;
    if (probe === undefined) {
      await probeAttach(ctx, attach);
      return;
    }
    if ((await readTick(ctx, attach, probe)) === "adb-missing") {
      state.adb = { available: false, reason: "missing" };
      detachDevice(ctx, attach.device);
      return;
    }
    await readMemory(ctx, attach, probe);
  } finally {
    attach.busy = false;
  }
}

/**
 * Starts the attach of a device: the record, the tick and heap timers, and the first tick (the
 * probe) at once.
 *
 * @param ctx - Domain context of connect.
 * @param device - The device id.
 * @param serial - Its adb serial.
 */
function startAttach(ctx: ConnectCtx, device: string, serial: string): void {
  const session = ctx
    .require(hubPlugin)
    .sessions()
    .find(item => item.device?.id === device);
  // eslint-disable-next-line unicorn/no-null -- null is "no session" on AttachRecord.page
  const attach = createAttachRecord(device, serial, session?.page ?? null);
  ctx.state.attaches.set(device, attach);
  attach.timers = {
    tick: unref(setInterval(() => void tick(ctx, attach), ctx.config.telemetryEveryMs)),
    heap: unref(setInterval(() => void sampleHeap(attach), ctx.config.heapEveryMs))
  };
  ctx.log.info("connect:attach", { device, serial });
  void tick(ctx, attach);
}

/**
 * Renews the lease of a tools connection on a device until `until`; leases that ran out are
 * dropped.
 *
 * @param state - The state.
 * @param device - The device id.
 * @param conn - The tools connection.
 * @param until - Epoch ms.
 */
function renewLease(state: ConnectState, device: string, conn: number, until: number): void {
  const leases = state.watches.get(device) ?? new Map<number, number>();
  const now = Date.now();
  for (const [holder, end] of leases) if (end <= now) leases.delete(holder);
  leases.set(conn, until);
  state.watches.set(device, leases);
}

/**
 * `connect.watch`: renews a tools connection's telemetry lease on a linked device and attaches it
 * when it is not attached — only for a phone by wire (an adb link matched to a phone adb lists).
 * A LAN device, an iPhone, a device not linked, adb missing or two phones of one model answer
 * `wired: false` with the reason, and no adb runs.
 *
 * @param ctx - Domain context of connect.
 * @param device - The device id.
 * @param conn - The tools connection that asks.
 * @returns Whether telemetry runs, and why not.
 */
export function watchDevice(ctx: ConnectCtx, device: string, conn: number): WatchAnswer {
  const { state } = ctx;
  const linked = ctx
    .require(hubPlugin)
    .devices()
    .find(item => item.id === device && item.online);
  if (linked === undefined) return { wired: false, reason: "not-linked" };
  if (APPLE_MODEL.test(linked.model ?? "")) return { wired: false, reason: "ios" };
  if (linked.link !== "adb") return { wired: false, reason: "not-wired" };
  if (!state.adb.available && state.adb.reason === "missing") {
    return { wired: false, reason: "adb-missing" };
  }

  const phones = currentDirectory(ctx).wire;
  const phone = phones.find(item => item.device === device);
  if (phone === undefined) {
    const ambiguous = phones.some(
      item => item.match === "ambiguous" && item.model === linked.model
    );
    return { wired: false, reason: ambiguous ? "ambiguous" : "not-linked" };
  }

  renewLease(state, device, conn, Date.now() + ctx.config.leaseMs);
  if (!state.attaches.has(device)) startAttach(ctx, device, phone.serial);
  return { wired: true };
}

/**
 * `connect.unwatch`: ends a tools connection's lease now; the device detaches when no other lease
 * holds it.
 *
 * @param ctx - Domain context of connect.
 * @param device - The device id.
 * @param conn - The tools connection.
 */
export function unwatchDevice(ctx: ConnectCtx, device: string, conn: number): void {
  const { state } = ctx;
  state.watches.get(device)?.delete(conn);
  if (leaseEnd(state, device) > Date.now()) return;
  state.watches.delete(device);
  detachDevice(ctx, device);
}
