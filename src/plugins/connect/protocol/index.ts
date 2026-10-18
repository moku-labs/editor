/**
 * @file connect/protocol barrel — the only barrel of the module. Runtime-free: the wire types of
 * the device directory and the wired telemetry, and their shape guards. Imported by relative path
 * from any core (registry/protocol's publish types, the tools page's link and activeSource,
 * renderView), never through the connect plugin.
 */
export { readDirectory, readTelemetry } from "./guards";
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
} from "./types";
