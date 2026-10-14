/**
 * @file collector plugin — the one `hub:device` handler: device mode listening starts the adb
 * loop; a batch of lines goes synchronously into its log's queue (one file per device log, found
 * or created; a new log closes the files of the device's other logs; at most MAX_LIVE_LOGS live
 * logs per device, the lines of one more are refused); a device that leaves makes its logs away (a
 * reconnect appends to the same file); device mode stopping makes every log done. Ignored after
 * onStop.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path/posix";
import { filesPlugin } from "../files";
import { normalizeModel } from "../hub/protocol";
import type { DeviceLines, HubDeviceEvent, LinkedDevice } from "../hub/types";
import type { PerfHeaderLine, PerfLogLine } from "../perf/protocol";
import { startAdbLoop, stopAdbLoop } from "./adb/loop";
import { fileNameOf } from "./session/name";
import { closeFile, closeLog, emitQueued, writeLines } from "./session/writer";
import { createLogSession } from "./state";
import type { CollectorCtx, CollectorHooks, LogSession } from "./types";

/** The most live logs one device may have (like the hub's MAX_LOGS per device record). */
export const MAX_LIVE_LOGS = 32;

/**
 * Whether a line is a header.
 *
 * @param item - A line of a batch.
 * @returns Whether its kind is header.
 */
function isHeader(item: PerfLogLine): item is PerfHeaderLine {
  return item.kind === "header";
}

/**
 * The absolute out folder: `out` against the files root, resolved on the first log.
 *
 * @param ctx - Domain context of the collector.
 * @returns The folder.
 */
function outDirOf(ctx: CollectorCtx): string {
  ctx.state.outDir ??= resolve(ctx.require(filesPlugin).root(), ctx.config.out);
  return ctx.state.outDir;
}

/**
 * The logs of a device.
 *
 * @param ctx - Domain context of the collector.
 * @param id - The device id.
 * @returns Its sessions.
 */
function sessionsOfDevice(ctx: CollectorCtx, id: string): LogSession[] {
  return [...ctx.state.sessions.values()].filter(session => session.device.id === id);
}

/**
 * The log session of a batch, created on its first batch: the model from the batch's first header,
 * else the device's, else "device"; the file named by the minute and the model, never a name
 * taken on disk or by another session. A new log closes the files of the device's other logs
 * (they reopen on their next line). A device with MAX_LIVE_LOGS live logs gets no new one.
 *
 * @param ctx - Domain context of the collector.
 * @param device - The device.
 * @param batch - The batch.
 * @returns The session, or undefined when the device is at the cap.
 */
function sessionOf(
  ctx: CollectorCtx,
  device: LinkedDevice,
  batch: DeviceLines
): LogSession | undefined {
  const { sessions } = ctx.state;
  const known = sessions.get(`${device.id}/${batch.log}`);
  if (known !== undefined) return known;

  const others = sessionsOfDevice(ctx, device.id);
  if (others.filter(other => other.state === "live").length >= MAX_LIVE_LOGS) return undefined;

  const header = batch.items.find(item => isHeader(item));
  const model = normalizeModel(header?.device?.model) ?? device.model ?? "device";
  const outDir = outDirOf(ctx);
  const files = new Set([...sessions.values()].map(session => session.file));
  const taken = (name: string): boolean =>
    files.has(join(outDir, name)) || existsSync(join(outDir, name));
  const file = join(outDir, fileNameOf(new Date(), model, taken));

  const session = createLogSession({ device, log: batch.log, file, model });
  sessions.set(session.key, session);
  for (const other of others) void closeFile(other);
  return session;
}

/**
 * Refuses the batch of a log over the device's cap: its lines are counted lost on the device; the
 * device's first refusal is warned.
 *
 * @param ctx - Domain context of the collector.
 * @param device - The device.
 * @param batch - The refused batch.
 */
function refuse(ctx: CollectorCtx, device: LinkedDevice, batch: DeviceLines): void {
  const { refused } = ctx.state;
  if (!refused.has(device.id)) {
    ctx.log.warn("collector:log-cap", { device: device.id, log: batch.log, cap: MAX_LIVE_LOGS });
  }
  const lines = batch.items.length + batch.gap + batch.rejected;
  refused.set(device.id, (refused.get(device.id) ?? 0) + lines);
}

/**
 * A device connected: its away logs are live again (no file is opened yet) and emit, after a
 * close still pending on their queue (so a replaced connection reports away, then live).
 *
 * @param ctx - Domain context of the collector.
 * @param device - The device.
 */
function onConnected(ctx: CollectorCtx, device: LinkedDevice): void {
  ctx.state.devices.set(device.id, device);
  for (const session of sessionsOfDevice(ctx, device.id)) {
    if (session.state !== "away") continue;
    session.state = "live";
    session.device = device;
    void emitQueued(ctx, session);
  }
}

/**
 * A batch of a device's log, written synchronously (no await before the enqueue), so batches
 * emitted back to back land in arrival order.
 *
 * @param ctx - Domain context of the collector.
 * @param device - The device.
 * @param batch - The batch.
 */
function onLines(ctx: CollectorCtx, device: LinkedDevice, batch: DeviceLines): void {
  const session = sessionOf(ctx, device, batch);
  if (session === undefined) {
    refuse(ctx, device, batch);
    return;
  }

  session.device = device;
  session.state = "live";
  void writeLines(ctx, session, batch);
}

/**
 * A device left: its live logs are away, their queues close the handles, then emit. The sessions
 * and their offsets stay: a reconnect appends to the same file.
 *
 * @param ctx - Domain context of the collector.
 * @param device - The device.
 */
function onClosed(ctx: CollectorCtx, device: LinkedDevice): void {
  ctx.state.devices.delete(device.id);
  for (const session of sessionsOfDevice(ctx, device.id)) {
    if (session.state !== "live") continue;
    session.state = "away";
    session.device = device;
    void closeLog(ctx, session);
  }
}

/**
 * Device mode stopped: the adb loop stops, every log is done, its queue closes the handle, then
 * emits.
 *
 * @param ctx - Domain context of the collector.
 */
function onStopped(ctx: CollectorCtx): void {
  stopAdbLoop(ctx);
  ctx.state.devices.clear();
  for (const session of ctx.state.sessions.values()) {
    if (session.state === "done") continue;
    session.state = "done";
    void closeLog(ctx, session);
  }
}

/**
 * Handles one `hub:device` event by kind; nothing after onStop.
 *
 * @param ctx - Domain context of the collector.
 * @param event - The event.
 */
export function onDevice(ctx: CollectorCtx, event: HubDeviceEvent): void {
  if (ctx.state.stopped) return;

  switch (event.kind) {
    case "listening": {
      startAdbLoop(ctx, event.listen.port);
      return;
    }
    case "connected": {
      onConnected(ctx, event.device);
      return;
    }
    case "lines": {
      onLines(ctx, event.device, event.lines);
      return;
    }
    case "closed": {
      onClosed(ctx, event.device);
      return;
    }
    default: {
      onStopped(ctx);
    }
  }
}

/**
 * collector's hooks factory (`hooks: createCollectorHooks`): the hub's per-plugin `hub:device`.
 *
 * @param ctx - Domain context of the collector.
 * @returns The hooks.
 */
export function createCollectorHooks(ctx: CollectorCtx): CollectorHooks {
  return {
    "hub:device": event => {
      onDevice(ctx, event);
    }
  };
}
