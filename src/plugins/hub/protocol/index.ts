/**
 * @file Device-link protocol barrel — the only barrel of hub/protocol. Runtime-free: re-exports the
 * device-link wire types, the 4401 constants and the pure helpers. Imported by relative path from
 * any core (the hub, files, the collector, registry/protocol for types, the agent's bridge and
 * overlay, the tools page's link), never through the hub plugin.
 */
export type {
  DeviceLink,
  DeviceLinkKind,
  EngineInfo,
  LinkJson,
  PairedParams,
  PairParams,
  PerfAckParams,
  PerfLinesParams,
  SessionDevice
} from "./device-link";
export {
  DEVICE_UNPAIRED_CODE,
  DEVICE_UNPAIRED_REASON,
  isLoopback,
  normalizeModel,
  parseAddress,
  parsePairParams,
  parsePerfLinesParams
} from "./device-link";
