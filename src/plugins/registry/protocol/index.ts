/**
 * @file Protocol barrel — the only barrel of the protocol module. Runtime-free: re-exports every
 * wire type and pure helper. Imported by hub, files, pages, link, workspace, panels, the views and
 * src/index.ts by relative path (D-02).
 */
export { checkInput, isJson } from "./check";
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
  DeviceSpec,
  EditorChannel,
  Effect,
  ErrorReason,
  FileBinary,
  FileEntry,
  FileText,
  Heartbeat,
  HelloBody,
  HelloParams,
  InputKind,
  InputOf,
  InputSchema,
  Json,
  LinkStatus,
  ListParams,
  Manifest,
  Message,
  Notification,
  PathParams,
  ReadParams,
  Request,
  Response,
  RunParams,
  RunResult,
  RunState,
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
