/**
 * @file Hub protocol barrel — the only barrel of hub/protocol. Runtime-free: re-exports the
 * device-link wire types, the 4401 constants and the pure helpers (`baseAppId` among them), and the tools-link types (the
 * `client` notification, the hello's capabilities, the stamped run) with `clientNameOf` and
 * `capsOf`. Imported by relative path from any
 * core (the hub, files, the collector, registry/protocol for types, the agent's bridge and overlay,
 * the tools page's link, the MCP bridge), never through the hub plugin.
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
  baseAppId,
  DEVICE_UNPAIRED_CODE,
  DEVICE_UNPAIRED_REASON,
  isLoopback,
  normalizeModel,
  parseAddress,
  parsePairParams,
  parsePerfLinesParams
} from "./device-link";
export type { AgentCap, ClientParams, HelloCaps, RunFrom, StampedRunParams } from "./tools-link";
export {
  CLIENT_METHOD,
  capsOf,
  clientNameOf,
  MAX_CLIENT_NAME,
  RUN_FROM_CAP
} from "./tools-link";
