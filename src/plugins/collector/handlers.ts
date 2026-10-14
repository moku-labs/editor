/**
 * @file collector plugin — the one `hub:device` handler: device mode listening starts the adb
 * loop; a batch of lines goes synchronously into its log's queue (one file per device log, found
 * or created); a device that leaves makes its logs away (a reconnect appends to the same file);
 * device mode stopping makes every log done. Ignored after onStop.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path/posix";
import { filesPlugin } from "../files";
import { normalizeModel } from "../hub/protocol";
import type { DeviceLines, HubDeviceEvent, LinkedDevice } from "../hub/types";
import type { PerfHeaderLine, PerfLogLine } from "../perf/protocol";
import { startAdbLoop, stopAdbLoop } from "./adb/loop";
import { fileNameOf } from "./session/name";
import { closeLog, emitNow, writeLines } from "./session/writer";
import { createLogSession } from "./state";
import type { CollectorCtx, CollectorHooks, LogSession } from "./types";

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
 * The log session of a batch, created on its first batch: the model from the batch's first header,
 * else the device's, else "device"; the file named by the minute and the model, never a name
 * taken on disk or by another session.
 *
 * @param ctx - Domain context of the collector.
 * @param device - The device.
 * @param batch - The batch.
 * @returns The session.
 */
function sessionOf(ctx: CollectorCtx, device: LinkedDevice, batch: DeviceLines): LogSession {
  const { sessions } = ctx.state;
  const known = sessions.get(`${device.id}/${batch.log}`);
  if (known !== undefined) return known;

  const header = batch.items.find(item => isHeader(item));
  const model = normalizeModel(header?.device?.model) ?? device.model ?? "device";
  const outDir = outDirOf(ctx);
  const files = new Set([...sessions.values()].map(session => session.file));
  const taken = (name: string): boolean =>
    files.has(join(outDir, name)) || existsSync(join(outDir, name));
  const file = join(outDir, fileNameOf(new Date(), model, taken));

  const session = createLogSession({ device, log: batch.log, file, model });
  sessions.set(session.key, session);
  return session;
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
 * A device connected: its away logs are live again (no file is opened yet) and emit.
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
    emitNow(ctx, session);
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
