/**
 * @file link plugin — type definitions: config, private constants, the remote channel api, the
 * files client, state and the domain context. Wire shapes come from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { ToolsEvents } from "../../config";
import type {
  EditorChannel,
  FileBinary,
  FileEntry,
  FileText,
  Json,
  LinkStatus,
  Manifest,
  SessionInfo,
  SubId,
  ToolsBoot,
  WriteResult
} from "../registry/protocol";

/**
 * No heartbeat of the chosen session for this long → silent (R6).
 */
export const SILENT_AFTER_MS = 6000;

/**
 * Used instead of SILENT_AFTER_MS when the last heartbeat said paused (R6).
 */
export const SILENT_AFTER_PAUSED_MS = 65_000;

/**
 * Interval of the silence check.
 */
export const SILENCE_CHECK_MS = 1000;

/**
 * Cap of the reconnect backoff.
 */
export const MAX_RETRY_MS = 8000;

/**
 * After the chosen session closed, lost turns into empty when no session appeared for this long.
 */
export const EMPTY_AFTER_LOST_MS = 10_000;

/**
 * Local guard on every request; link's callTimeoutMs in the R1 long-call rule.
 */
export const CALL_TIMEOUT_MS = 10_000;

/**
 * Cap of the durationMs extension of a long call (R1).
 */
export const LONG_CALL_CAP_MS = 60_000;

/**
 * Link configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { link: { retryMs: 500 } } });
 * ```
 */
export type Config = {
  /** Base delay of the reconnect backoff, in ms. Default 1000. */
  retryMs: number;
  /** CSS selector of the JSON script tag pages injects. Default "#moku-editor-boot". */
  boot: string;
};

/**
 * The files channel as the tools views use it (R1, R4).
 *
 * @example
 * ```ts
 * await app.link.files.write(".moku/notes/2026-09-24-first-top-item.md", text);
 * ```
 */
export type FilesClient = {
  list(dir: string): Promise<readonly FileEntry[]>;
  read(path: string): Promise<FileText>;
  write(path: string, text: string, version?: string): Promise<WriteResult>;
  writeBinary(path: string, dataUrl: string): Promise<WriteResult>;
  readBinary(path: string): Promise<FileBinary>;
};

/**
 * The link api: the remote EditorChannel plus sessions, manifest, boot and the files client.
 *
 * @example
 * ```ts
 * const ran = await app.link.run("game.step", { frames: 1 }); // ran.state.frame === 1841
 * ```
 */
export type LinkApi = EditorChannel & {
  manifest(): Manifest | undefined;
  onManifest(fn: (manifest: Manifest | undefined) => void): () => void;
  sessions(): readonly SessionInfo[];
  session(): string | undefined;
  choose(session: string): Promise<Manifest>;
  retry(): void;
  boot(): ToolsBoot | undefined;
  files: FilesClient;
};

/**
 * One watch record; kept while disconnected and re-sent after every attach (R4).
 */
export type Subscription = {
  /** Local id, never sent. */
  readonly key: number;
  readonly id: string;
  readonly input: Json | undefined;
  readonly onValue: (value: Json) => void;
  /** Numeric wire sub while attached (R6), else undefined. */
  wireSub: SubId | undefined;
};

/**
 * One request in flight.
 */
export type PendingCall = {
  readonly resolve: (value: Json) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

/**
 * Inputs of the pure status reducer.
 */
export type StatusInput =
  | { type: "socket-open" }
  | { type: "socket-closed"; reason: string; retryInMs: number }
  | { type: "no-boot" }
  | { type: "sessions"; attached: boolean; count: number }
  | { type: "attached" }
  | { type: "heartbeat"; frame: number; paused: boolean }
  | { type: "silence"; since: number }
  | { type: "session-closed"; reason: string; retryInMs: number }
  | { type: "lost-expired" };

/**
 * Link state.
 */
export type LinkState = {
  status: LinkStatus;
  boot: ToolsBoot | undefined;
  socket: WebSocket | undefined;
  open: boolean;
  attempt: number;
  nextId: number;
  pending: Map<number, PendingCall>;
  sessions: readonly SessionInfo[];
  chosen: string | undefined;
  sticky: boolean;
  manifests: Map<string, Manifest>;
  manifestListeners: Set<(manifest: Manifest | undefined) => void>;
  subs: Map<number, Subscription>;
  wire: Map<SubId, Subscription>;
  /** Only grows: a sub number is never reused, so late values of an old sub are dropped. */
  nextSub: SubId;
  /** Bumped on every attach; an answer of an older attach is ignored. */
  generation: number;
  nextKey: number;
  heartbeat: { frame: number; paused: boolean; receivedAt: number } | undefined;
  lostAt: number | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  silenceTimer: ReturnType<typeof setInterval> | undefined;
  /** Set by onStop; every callback returns early when true. */
  stopped: boolean;
};

/**
 * Domain context of link: the kernel context is assignable to it.
 */
export type LinkCtx = {
  readonly config: Readonly<Config>;
  state: LinkState;
  readonly emit: EmitFn<Pick<ToolsEvents, "link:status">>;
  readonly log: Log.LogApi;
};
