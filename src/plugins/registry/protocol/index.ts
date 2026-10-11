/**
 * @file Protocol barrel — the only barrel of the protocol module. Runtime-free: re-exports every
 * wire type and pure helper (commandsHash, pickSession and the project-index helpers included),
 * the device presets and the overlay host marker. Imported by hub, files, pages, link, workspace,
 * panels, the views, the agent plugins and src/index.ts by relative path (D-02).
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
  parseDeviceInfo,
  parseDeviceParams,
  parseNodeInfo,
  parseNodeParams,
  parseShowInfo,
  parseShowParams,
  WORKSPACE_NAMES
} from "./editor-requests";
export {
  bareMessage,
  ERROR_PREFIX,
  errorCode,
  fromWireError,
  isRetryable,
  isVersionConflict,
  isWireError,
  ProtocolError,
  toWireError,
  wireError
} from "./errors";
export { commandsHash } from "./hash";
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
export {
  anchorKey,
  firstDefinition,
  parseFoundList,
  parseProjectState,
  projectDelta
} from "./project";
export type { HotSwapEntry } from "./reload";
export { isHotSwapEntry, isReloading } from "./reload";
export { isSelectionInfo, parseSelectionInfo, parseSelectParams } from "./selection";
export { pickSession } from "./session-choice";
export type {
  Changes,
  Channel,
  CommandDescriptor,
  DeviceInfo,
  DeviceParams,
  DevicePresetId,
  DevicePresetInfo,
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
  FindParams,
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
  NodeInfo,
  NodeParams,
  NodeRef,
  Notification,
  Orientation,
  PathParams,
  PictureFormat,
  ProjectAnchor,
  ProjectChange,
  ProjectDelta,
  ProjectFound,
  ProjectMove,
  ProjectState,
  PublishMethod,
  PublishParams,
  ReadParams,
  RelayedEditorMethod,
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
  ShowInfo,
  ShowParams,
  SourceDescriptor,
  SubId,
  Tap,
  ToolsBoot,
  UnwatchParams,
  ValueParams,
  WatchParams,
  WireError,
  WireErrorData,
  WorkspaceName,
  WriteBinaryParams,
  WriteParams,
  WriteResult
} from "./types";
export { toWireValue } from "./wire-value";
