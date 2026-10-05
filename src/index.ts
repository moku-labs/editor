// biome-ignore-all assist/source/organizeImports: sectioned manifest (protocol types → protocol helpers → panels) is house style
/**
 * The `@moku-labs/editor` package root. Runtime-free: the wire protocol shared by the game page,
 * the server and the tools page (types and pure helpers, including the node → file rule), and
 * `definePanel` with its types. It imports no plugin instance and no core (D-01).
 *
 * Subpaths next to the root:
 *
 * | Subpath | What |
 * |---|---|
 * | `@moku-labs/editor/agent` | the game page core: registry, channel, overlay; opt-in bridge and capture |
 * | `@moku-labs/editor/server` | the Bun core: files, hub, pages; `hub.serve()` for `Bun.serve` |
 * | `@moku-labs/editor/tools` | the tools page core: link, workspace, panels and the six workspaces |
 *
 * @file The package root: the wire protocol and definePanel.
 * @example
 * ```ts
 * import { checkInput, definePanel, type Manifest } from "@moku-labs/editor";
 * ```
 */

// ─── Protocol: types ──────────────────────────────────────────
export type {
  Changes,
  Channel,
  CommandDescriptor,
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
  HotSwapEntry,
  InputKind,
  InputOf,
  InputSchema,
  Json,
  LinkStatus,
  ListParams,
  Manifest,
  Message,
  NodeRef,
  Notification,
  PathParams,
  PictureFormat,
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
  SourceOverrides,
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
} from "./plugins/registry/protocol";

// ─── Protocol: helpers (pure) ─────────────────────────────────
export {
  bareMessage,
  checkInput,
  decode,
  encode,
  ERROR_PREFIX,
  errorCode,
  failure,
  flowFile,
  fromWireError,
  isFailure,
  isHotSwapEntry,
  isJson,
  isNotification,
  isReloading,
  isRequest,
  isResponse,
  isRetryable,
  isSelectionInfo,
  isWireError,
  kebab,
  nodeFile,
  notification,
  parseOverrides,
  parseSelectionInfo,
  parseSelectParams,
  ProtocolError,
  request,
  SOURCE_OVERRIDES_PATH,
  SOURCE_ROOTS,
  success,
  toWireError,
  toWireValue,
  wireError
} from "./plugins/registry/protocol";

// ─── Panels ───────────────────────────────────────────────────
export { definePanel } from "./plugins/panels/define";
export type { SourceValue } from "./plugins/panels/catalogue";
export type {
  CompactTools,
  PanelInput,
  PanelSpec,
  PanelTools,
  PanelValues,
  SourceRef
} from "./plugins/panels/types";
