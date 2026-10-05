/**
 * @file Protocol barrel — the only barrel of the protocol module. Runtime-free: re-exports every
 * wire type and pure helper, the device presets and the overlay host marker. Imported by hub,
 * files, pages, link, workspace, panels, the views, the agent plugins and src/index.ts by relative
 * path (D-02).
 */
export { checkInput, isJson } from "./check";
export {
  DEFAULT_DEVICE,
  DEVICE_GROUPS,
  DEVICES,
  deviceById,
  isDevicePresetId,
  presetOf,
  resolveDevice,
  screenOf
} from "./devices";
export {
  bareMessage,
  ERROR_PREFIX,
  errorCode,
  fromWireError,
  isRetryable,
  isWireError,
  ProtocolError,
  toWireError,
  wireError
} from "./errors";
export {
  decode,
  encode,
  failure,
  isFailure,
  isNotification,
  isRequest,
  isResponse,
  notification,
  request,
  success
} from "./messages";
export { HOST_ATTRIBUTE } from "./overlay-host";
export { isSelectionInfo, parseSelectionInfo, parseSelectParams } from "./selection";
export type { NodeRef, SourceOverrides } from "./source-files";
export {
  flowFile,
  kebab,
  nodeFile,
  parseOverrides,
  SOURCE_OVERRIDES_PATH,
  SOURCE_ROOTS
} from "./source-files";
export type {
  Changes,
  Channel,
  CommandDescriptor,
  DevicePresetId,
  DeviceSize,
  DeviceSpec,
  EditorChannel,
  EditorNotificationMethod,
  EditorNotifications,
  EditorRequestMethod,
  EditorRequests,
  Effect,
  ErrorReason,
  FileBinary,
  FileEntry,
  FileText,
  FoldScreen,
  Heartbeat,
  HelloBody,
  HelloParams,
  HotReload,
  InputKind,
  InputOf,
  InputSchema,
  Json,
  LinkStatus,
  ListParams,
  Manifest,
  Message,
  Notification,
  Orientation,
  PathParams,
  PublishMethod,
  PublishParams,
  ReadParams,
  Request,
  Response,
  RunParams,
  RunResult,
  RunState,
  SelectionInfo,
  SelectionItem,
  SelectionRect,
  SelectionRef,
  SelectParams,
  SessionInfo,
  SessionParams,
  SessionsParams,
  SourceDescriptor,
  SubId,
  Tap,
  ToolsBoot,
  UnwatchParams,
  ValueParams,
  WatchParams,
  WireError,
  WireErrorData,
  WriteBinaryParams,
  WriteParams,
  WriteResult
} from "./types";
export { toWireValue } from "./wire-value";
