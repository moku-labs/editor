/**
 * @file connect plugin — type definitions: the config, and the wire types of `connect/protocol`
 * re-exported for the plugin's own files and the `Connect` namespace of the server entry.
 */

export type {
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
  TelemetryOffReason,
  WireDevice
} from "./protocol";

/**
 * Connect configuration (spec 11 § 3 Config). Flat: per-plugin config merges shallowly.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { connect: { adb: "/opt/android/platform-tools/adb", wire: "auto" } } });
 * ```
 */
export type ConnectConfig = {
  /** The adb command, a name on PATH or a path. */
  adb: string;
  /** One adb call is killed after this many ms. */
  adbTimeoutMs: number;
  /** `adb devices -l` period while a scan lease or device mode is on. */
  scanEveryMs: number;
  /** A ready phone with no device session for this long reads "no debug game answered". */
  answerTimeoutMs: number;
  /** A scan or watch lease not renewed for this long ends. */
  leaseMs: number;
  /** The wired telemetry tick. */
  telemetryEveryMs: number;
  /** `dumpsys meminfo` period. */
  meminfoEveryMs: number;
  /** CDP Runtime.getHeapUsage period. */
  heapEveryMs: number;
  /** A heap drop of at least this many MB between two samples is an inferred GC. */
  gcDropMb: number;
  /** Exact GC events through CDP Tracing (heavier). */
  gcTrace: boolean;
  /** "auto": turn the adb listener on at start when adb is on PATH and the port is free. */
  wire: "manual" | "auto";
};
