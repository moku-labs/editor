/**
 * @file connect/protocol — the shape guards of the two values connect publishes, `editor.devices`
 * and `editor.deviceTelemetry`. The tools page's link checks every published value with them before
 * it keeps it (spec 11 § 5.2): a malformed value is refused whole, so no panel reads past it.
 * Runtime-free and pure: no import beyond this module's types, no allocation beyond the answer.
 */
import type {
  DeviceDirectory,
  DeviceTelemetry,
  GpuLoad,
  HeapGc,
  HeapSample,
  LinkedEntry,
  ListenInfo,
  PairAsk,
  ProcessCpu,
  ProcessMemory,
  Reading,
  ReadingOffReason,
  WireDevice
} from "./types";

/** The fields of a parsed JSON object, before they are checked. */
type Fields = { readonly [key: string]: unknown };

/** A guard of one shape. */
type Guard<T> = (value: unknown) => value is T;

/** The device link kinds of hub/protocol. */
const LINK_KINDS = ["adb", "lan"] as const;

/** `WireDevice.state`. */
const WIRE_STATES: readonly WireDevice["state"][] = ["device", "unauthorized", "offline", "other"];

/** `WireDevice.transport`. */
const TRANSPORTS: readonly WireDevice["transport"][] = ["usb", "wifi"];

/** `WireDevice.phase`. */
const PHASES: readonly WireDevice["phase"][] = [
  "unauthorized",
  "offline",
  "ready",
  "waiting",
  "no-agent",
  "linked"
];

/** `DeviceDirectory.mode.owner` without null. */
const OWNERS: readonly NonNullable<DeviceDirectory["mode"]["owner"]>[] = ["connect", "other"];

/** `DeviceDirectory.confirmIn` without null. */
const CONFIRM_IN: readonly NonNullable<DeviceDirectory["confirmIn"]>[] = ["page", "terminal"];

/** `DeviceDirectory.adb.reason`. */
const ADB_REASONS: readonly NonNullable<DeviceDirectory["adb"]["reason"]>[] = ["missing", "error"];

/** Every `ReadingOffReason`. */
const OFF_REASONS: readonly ReadingOffReason[] = [
  "not-wired",
  "ios",
  "no-permission",
  "unreadable",
  "unknown-format",
  "not-found",
  "ambiguous",
  "no-devtools-socket",
  "no-target",
  "warming-up",
  "adb-missing",
  "error"
];

/**
 * Whether a value is a JSON object (not null, not an array).
 *
 * @param value - The value.
 * @returns True for an object.
 */
function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a finite number.
 *
 * @param value - The value.
 * @returns True for a finite number.
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Whether a value is a finite number or null.
 *
 * @param value - The value.
 * @returns True for a finite number or null.
 */
function isNumberOrNull(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

/**
 * Whether a value is a string or null.
 *
 * @param value - The value.
 * @returns True for a string or null.
 */
function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Whether a value is one of a list of strings.
 *
 * @param value - The value.
 * @param options - The allowed strings.
 * @returns True for one of them.
 */
function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  const names: readonly string[] = options;
  return typeof value === "string" && names.includes(value);
}

/**
 * Whether a value is an array whose every item passes a guard.
 *
 * @param value - The value.
 * @param item - The guard of one item.
 * @returns True for such an array.
 */
function isListOf<T>(value: unknown, item: Guard<T>): value is readonly T[] {
  return Array.isArray(value) && value.every(entry => item(entry));
}

/**
 * Whether a value is device mode's listen addresses.
 *
 * @param value - The value.
 * @returns True for a ListenInfo.
 */
function isListenInfo(value: unknown): value is ListenInfo {
  return (
    isFields(value) &&
    isNumber(value.port) &&
    typeof value.adb === "string" &&
    isTextOrNull(value.lan)
  );
}

/**
 * Whether a value is a phone adb lists.
 *
 * @param value - The value.
 * @returns True for a WireDevice.
 */
function isWireDevice(value: unknown): value is WireDevice {
  return (
    isFields(value) &&
    typeof value.serial === "string" &&
    isOneOf(value.state, WIRE_STATES) &&
    isOneOf(value.transport, TRANSPORTS) &&
    isTextOrNull(value.model) &&
    isTextOrNull(value.name) &&
    isTextOrNull(value.os) &&
    isOneOf(value.phase, PHASES) &&
    isTextOrNull(value.device) &&
    (value.match === undefined || value.match === "ambiguous")
  );
}

/**
 * Whether a value is a pairing waiting for the person.
 *
 * @param value - The value.
 * @returns True for a PairAsk.
 */
function isPairAsk(value: unknown): value is PairAsk {
  return (
    isFields(value) &&
    typeof value.ticket === "string" &&
    isTextOrNull(value.model) &&
    typeof value.address === "string" &&
    isOneOf(value.link, LINK_KINDS) &&
    isTextOrNull(value.engine) &&
    isTextOrNull(value.build) &&
    isNumber(value.since)
  );
}

/**
 * Whether a value is a linked device entry.
 *
 * @param value - The value.
 * @returns True for a LinkedEntry.
 */
function isLinkedEntry(value: unknown): value is LinkedEntry {
  return (
    isFields(value) &&
    typeof value.id === "string" &&
    isTextOrNull(value.model) &&
    isOneOf(value.link, LINK_KINDS) &&
    typeof value.address === "string" &&
    typeof value.online === "boolean" &&
    isTextOrNull(value.engine) &&
    isTextOrNull(value.build) &&
    isNumberOrNull(value.latencyMs) &&
    isTextOrNull(value.session)
  );
}

/**
 * Whether a value is the directory's device mode.
 *
 * @param value - The value.
 * @returns True for a DeviceDirectory mode.
 */
function isMode(value: unknown): value is DeviceDirectory["mode"] {
  return (
    isFields(value) &&
    typeof value.on === "boolean" &&
    (value.owner === null || isOneOf(value.owner, OWNERS)) &&
    (value.listen === null || isListenInfo(value.listen))
  );
}

/**
 * Whether a value is the directory's adb availability.
 *
 * @param value - The value.
 * @returns True for a DeviceDirectory adb record.
 */
function isAdb(value: unknown): value is DeviceDirectory["adb"] {
  return (
    isFields(value) &&
    typeof value.available === "boolean" &&
    (value.reason === undefined || isOneOf(value.reason, ADB_REASONS))
  );
}

/**
 * Whether a value is a whole device directory.
 *
 * @param value - The value.
 * @returns True for a DeviceDirectory.
 */
function isDirectory(value: unknown): value is DeviceDirectory {
  return (
    isFields(value) &&
    value.v === 1 &&
    isMode(value.mode) &&
    (value.confirmIn === null || isOneOf(value.confirmIn, CONFIRM_IN)) &&
    isAdb(value.adb) &&
    isListOf(value.wire, isWireDevice) &&
    isListOf(value.asking, isPairAsk) &&
    isListOf(value.linked, isLinkedEntry) &&
    isNumber(value.at)
  );
}

/**
 * Whether a value is a reading of a value a guard checks: available with that value, or not
 * available with a known reason. Both name their source.
 *
 * @param value - The value.
 * @param isValue - The guard of the reading's value.
 * @returns True for a Reading.
 */
function isReadingOf<T>(value: unknown, isValue: Guard<T>): value is Reading<T> {
  if (!isFields(value) || typeof value.source !== "string") return false;
  if (value.available === true) return isValue(value.value);
  return value.available === false && isOneOf(value.reason, OFF_REASONS);
}

/**
 * Whether a value is a GPU clock and busy reading.
 *
 * @param value - The value.
 * @returns True for a GpuLoad.
 */
function isGpuLoad(value: unknown): value is GpuLoad {
  return (
    isFields(value) &&
    isNumberOrNull(value.mhz) &&
    isNumberOrNull(value.busyPct) &&
    isNumberOrNull(value.minMhz) &&
    isNumberOrNull(value.maxMhz)
  );
}

/**
 * Whether a value is the CPU of one process.
 *
 * @param value - The value.
 * @returns True for a ProcessCpu.
 */
function isProcessCpu(value: unknown): value is ProcessCpu {
  return (
    isFields(value) &&
    isNumber(value.pid) &&
    typeof value.name === "string" &&
    isNumber(value.pct) &&
    isNumber(value.oneCorePct)
  );
}

/**
 * Whether a value is the memory of one process.
 *
 * @param value - The value.
 * @returns True for a ProcessMemory.
 */
function isProcessMemory(value: unknown): value is ProcessMemory {
  return (
    isFields(value) &&
    isNumber(value.pid) &&
    isNumber(value.totalPssMb) &&
    isNumberOrNull(value.javaMb) &&
    isNumberOrNull(value.nativeMb) &&
    isNumberOrNull(value.graphicsMb) &&
    isNumberOrNull(value.glMb) &&
    isNumberOrNull(value.codeMb) &&
    isNumberOrNull(value.stackMb) &&
    isNumberOrNull(value.otherMb) &&
    isNumberOrNull(value.systemMb) &&
    isNumber(value.at)
  );
}

/**
 * Whether a value is one heap sample.
 *
 * @param value - The value.
 * @returns True for a HeapSample.
 */
function isHeapSample(value: unknown): value is HeapSample {
  return isFields(value) && isNumber(value.t) && isNumber(value.usedMb) && isNumber(value.totalMb);
}

/**
 * Whether a value is one GC.
 *
 * @param value - The value.
 * @returns True for a HeapGc.
 */
function isHeapGc(value: unknown): value is HeapGc {
  return (
    isFields(value) &&
    isNumber(value.t) &&
    isNumber(value.freedMb) &&
    typeof value.inferred === "boolean"
  );
}

/**
 * Whether a value is the heap samples and GCs of one tick.
 *
 * @param value - The value.
 * @returns True for the heap reading's value.
 */
function isHeap(
  value: unknown
): value is { readonly samples: readonly HeapSample[]; readonly gcs: readonly HeapGc[] } {
  return isFields(value) && isListOf(value.samples, isHeapSample) && isListOf(value.gcs, isHeapGc);
}

/**
 * Whether a value is the CPU block of a record.
 *
 * @param value - The value.
 * @returns True for DeviceTelemetry["cpu"].
 */
function isCpu(value: unknown): value is DeviceTelemetry["cpu"] {
  return (
    isFields(value) &&
    isNumberOrNull(value.cores) &&
    isReadingOf(value.app, isProcessCpu) &&
    isReadingOf(value.renderer, isProcessCpu) &&
    isReadingOf(value.surfaceflinger, isProcessCpu)
  );
}

/**
 * Whether a value is the memory block of a record.
 *
 * @param value - The value.
 * @returns True for DeviceTelemetry["memory"].
 */
function isMemory(value: unknown): value is DeviceTelemetry["memory"] {
  return (
    isFields(value) &&
    isReadingOf(value.app, isProcessMemory) &&
    isReadingOf(value.renderer, isProcessMemory)
  );
}

/**
 * Whether a value is a whole telemetry record.
 *
 * @param value - The value.
 * @returns True for a DeviceTelemetry.
 */
function isTelemetry(value: unknown): value is DeviceTelemetry {
  return (
    isFields(value) &&
    value.v === 1 &&
    typeof value.device === "string" &&
    isTextOrNull(value.serial) &&
    isNumber(value.at) &&
    typeof value.wired === "boolean" &&
    isReadingOf(value.gpu, isGpuLoad) &&
    isCpu(value.cpu) &&
    isMemory(value.memory) &&
    isReadingOf(value.heap, isHeap)
  );
}

/**
 * Reads a published `editor.devices` value: the directory when every part of it has its shape,
 * else undefined (the tools page then keeps the directory it had and warns).
 *
 * @param value - The published value.
 * @returns The directory, or undefined for another shape.
 * @example
 * ```ts
 * readDirectory({ v: 1, mode: { on: false, owner: null, listen: null }, confirmIn: null, adb: { available: true },
 *   wire: [], asking: [], linked: [], at: 1791986083963 })?.mode.on; // false
 * readDirectory({ v: 2 }); // undefined
 * ```
 */
export function readDirectory(value: unknown): DeviceDirectory | undefined {
  return isDirectory(value) ? value : undefined;
}

/**
 * Reads a published `editor.deviceTelemetry` value: the record when every reading has its shape
 * (available with its value, or not available with a known reason), else undefined.
 *
 * @param value - The published value.
 * @returns The record, or undefined for another shape.
 * @example
 * ```ts
 * readTelemetry(record)?.gpu; // { available: true, source: "/sys/kernel/gpu", value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 } }
 * readTelemetry({ v: 1, device: "d-7f3a" }); // undefined
 * ```
 */
export function readTelemetry(value: unknown): DeviceTelemetry | undefined {
  return isTelemetry(value) ? value : undefined;
}
