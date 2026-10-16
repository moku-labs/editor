/**
 * @file activeSource plugin — type definitions (spec 11 § 4): the config, the one source of the page
 * and the local preview's pause state, the source changes, markers, label, health and notice, the
 * state, the api, the per-plugin events, the domain contexts and the hook. The wire types of
 * connect (directory, telemetry, listen) come from `connect/protocol`, the device of a session from
 * `hub/protocol`, all type-only.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type { DeviceDirectory, DeviceTelemetry, ListenInfo } from "../connect/protocol";
import type { SessionDevice } from "../hub/protocol";

/**
 * activeSource configuration (spec 11 § 4 Config). Flat: per-plugin config merges shallowly.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { activeSource: { autoUse: false, rejoinMs: 30_000 } } });
 * ```
 */
export type ActiveSourceConfig = {
  /** A device that links while the local preview is the source becomes the source. */
  autoUse: boolean;
  /** Pause the local preview while a device is the source. */
  pauseLocal: boolean;
  /** A lost device that returns within this many ms becomes the source again (0 to 600 000). */
  rejoinMs: number;
  /** How long the disconnect notice shows, ms (1000 to 120 000). */
  noticeMs: number;
  /** How often the scan and watch leases are renewed, ms (500 to 60 000; connect's leaseMs is 10 s). */
  renewMs: number;
  /** Markers kept (1 to 512). */
  markers: number;
};

/**
 * Where the page's data comes from: this page's local preview (session null on a page without one,
 * the tools page of `moku-editor perf`), a device session, or another game page (another tab's
 * frame, a hand-opened page).
 *
 * @example
 * ```ts
 * const local: ActiveSource = { kind: "local", session: "s-1" };
 * const phone: ActiveSource = { kind: "device", session: "s-9", device: { id: "d-7f3a", model: "SM-A266B", link: "adb",
 *   address: "127.0.0.1", port: 47600, engine: "0.15.0+9c41e0", build: "debug-20261016T090000Z" } };
 * ```
 */
export type ActiveSource =
  | { readonly kind: "local"; readonly session: string | null }
  | { readonly kind: "device"; readonly session: string; readonly device: SessionDevice }
  | { readonly kind: "page"; readonly session: string };

/**
 * The local preview as the source switch sees it: running, paused by this plugin while a device is
 * the source, held (paused by the person before the switch), none (no local preview), pausing or
 * resuming (a command in flight), or unpausable (`game.pause` refused or failed, with the reason).
 *
 * @example
 * ```ts
 * const paused: LocalPreview = { state: "paused-by-source" };
 * const refused: LocalPreview = { state: "unpausable", reason: "the game's build has no game.pause" };
 * ```
 */
export type LocalPreview =
  | { readonly state: "running" | "paused-by-source" | "held" | "none" }
  | { readonly state: "pausing" | "resuming" }
  | { readonly state: "unpausable"; readonly reason: string };

/**
 * A source change: from, to, why, and when (epoch ms of this computer). The payload of the
 * per-plugin event `activeSource:changed` and of `onChange` listeners.
 *
 * @example
 * ```ts
 * const change: SourceChange = { from: { kind: "local", session: "s-1" }, to: { kind: "local", session: null },
 *   reason: "lost", at: 1791986093963 };
 * ```
 */
export type SourceChange = {
  readonly from: ActiveSource;
  readonly to: ActiveSource;
  readonly reason: "connected" | "user" | "lost" | "rejoined" | "stopped" | "adopted";
  readonly at: number;
};

/**
 * A marker for the timelines, at a source change (epoch ms of this computer).
 *
 * @example
 * ```ts
 * const marker: SourceMarker = { at: 1791986093963, kind: "lost", label: "Galaxy A26 disconnected here · Local preview resumed", device: "d-7f3a" };
 * ```
 */
export type SourceMarker = {
  readonly at: number;
  readonly kind: "connected" | "lost" | "user" | "rejoined";
  readonly label: string;
  readonly device: string | null;
};

/**
 * What the connection bar names: the source's display name, model, kind and link.
 *
 * @example
 * ```ts
 * const label: SourceLabel = { name: "Galaxy A26", model: "SM-A266B", kind: "device",
 *   link: { kind: "wire", transport: "adb", address: "127.0.0.1" } };
 * ```
 */
export type SourceLabel = {
  /** "Galaxy A26" (marketing name), "SM-A266B", "Local preview". */
  readonly name: string;
  readonly model: string | null;
  readonly kind: "local" | "device" | "page";
  readonly link: {
    readonly kind: "wire" | "network" | "local";
    readonly transport: "adb" | "lan" | "frame";
    readonly address: string | null;
  };
};

/**
 * Link health of the active source: one sample a second, 48 kept (48 s) in a ring allocated once.
 *
 * @example
 * ```ts
 * const health: SourceHealth = { kind: "wire", latencyMs: 9, samples: new Float32Array(48).fill(Number.NaN), head: 17 };
 * ```
 */
export type SourceHealth = {
  readonly kind: "wire" | "network" | "local";
  /** The newest latency, ms; null for the local preview and before the first sample. */
  readonly latencyMs: number | null;
  /** The ring of samples, allocated once; NaN = no sample. */
  readonly samples: Float32Array;
  /** Index of the newest sample in `samples`. */
  readonly head: number;
};

/**
 * The disconnect notice while it shows: the device, its model, the text, until when (epoch ms), and
 * whether the device is back (a "connected — Use" notice of a second device has `back: true`).
 *
 * @example
 * ```ts
 * const notice: SourceNotice = { device: "d-7f3a", model: "SM-A266B", text: "Galaxy A26 disconnected. Showing the local preview.",
 *   until: 1791986105963, back: false };
 * ```
 */
export type SourceNotice = {
  readonly device: string;
  readonly model: string | null;
  readonly text: string;
  readonly until: number;
  readonly back: boolean;
};

/**
 * The payload of the per-plugin event `activeSource:connect-requested`: which way the Connect panel
 * shows first (undefined: the panel picks).
 *
 * @example
 * ```ts
 * const request: ConnectRequest = { tab: "network" };
 * ```
 */
export type ConnectRequest = { readonly tab: "wire" | "network" | undefined };

/**
 * The per-plugin events of activeSource, visible to workspace and renderView through `depends`.
 *
 * @example
 * ```ts
 * ctx.emit("activeSource:connect-requested", { tab: "wire" });
 * ```
 */
export type ActiveSourceEvents = {
  readonly "activeSource:changed": SourceChange;
  readonly "activeSource:connect-requested": ConnectRequest;
};

/**
 * activeSource state (private, mutable through `ctx.state`).
 */
export type ActiveSourceState = {
  /** The current source; starts `{ kind: "local", session: null }` until link lists sessions. */
  current: ActiveSource;
  /** The local preview's pause state; starts "none". */
  preview: LocalPreview;
  /** The local session this plugin paused (its resume target); undefined when it paused nothing. */
  pausedSession: string | undefined;
  /** The device id last lost and when (epoch ms), for the rejoin rule; cleared by any explicit choice. */
  lost: { readonly device: string; readonly model: string | null; readonly at: number } | undefined;
  /** The disconnect notice, while it shows. */
  notice: SourceNotice | undefined;
  /** Source changes, newest last, at most config.markers. */
  markers: SourceMarker[];
  /** Device ids already seen in link.sessions(), so autoUse fires once per link-up. */
  seen: Set<string>;
  /** Unsubscribers of link.onSessions and link.onPublished. */
  off: (() => void)[];
  /** The lease renewal (scan and watch leases, every renewMs) and the notice timer. */
  timers: {
    renew: ReturnType<typeof setInterval> | undefined;
    notice: ReturnType<typeof setTimeout> | undefined;
  };
  /** Open scan() handles: connect's scan lease is renewed while this is above 0. */
  scans: number;
  /** The health ring of the active device: 48 samples at 1 Hz, allocated once; NaN = no sample. */
  health: { readonly samples: Float32Array; head: number; latencyMs: number | null };
  /**
   * Clock offset estimates (phone epoch − computer epoch, ms) of the active device's last 8
   * heartbeats, allocated once; `count` of them are set.
   */
  offsets: { readonly values: Float64Array; head: number; count: number };
  /** Listeners of onChange. */
  listeners: Set<(change: SourceChange) => void>;
  /** Listeners of onTelemetry. */
  telemetryListeners: Set<(record: DeviceTelemetry) => void>;
  /** The newest telemetry record of the active device; undefined when none arrived. */
  telemetry: DeviceTelemetry | undefined;
  /** A switch in flight: a counter, so a newer switch supersedes an older one. */
  switching: number;
  /** Set by onStop: late callbacks do nothing after it. */
  stopped: boolean;
};

/**
 * The activeSource api (`app.activeSource`, `ctx.require(activeSourcePlugin)`): the one source of the
 * tools page, the switch between the local preview and a device, the Connect panel's actions and the
 * wired telemetry of the active device.
 */
export type ActiveSourceApi = {
  /**
   * The active source.
   *
   * @returns The source; `{ kind: "local", session: null }` on a page without a local preview.
   * @example
   * ```ts
   * app.activeSource.current(); // { kind: "device", session: "s-9", device: { id: "d-7f3a", model: "SM-A266B", link: "adb", … } }
   * ```
   */
  current(): ActiveSource;

  /**
   * The local preview's pause state.
   *
   * @returns The state.
   * @example
   * ```ts
   * app.activeSource.preview(); // { state: "paused-by-source" } while the Galaxy A26 is the source
   * ```
   */
  preview(): LocalPreview;

  /**
   * Makes a device session the source: pauses the local preview (pauseLocal) before link chooses the
   * device, chooses the session in link, starts the telemetry lease. Choosing the current source does
   * nothing.
   *
   * @param session - A session id of link.sessions() whose entry has `device`.
   * @returns When link attached the session.
   * @throws {TypeError} `[moku-editor] activeSource.useDevice needs a device session, got "s-2".\n  Pass an
   *   id from link.sessions() that has a device.` for a session without `device`.
   * @throws {Error} link's -32003 `choose_session` for an id that is not open.
   * @example
   * ```ts
   * await app.activeSource.useDevice("s-9"); // the local preview pauses; every workspace reads the Galaxy A26
   * ```
   */
  useDevice(session: string): Promise<void>;

  /**
   * Makes this page's local preview the source: chooses its session and resumes it unless the person
   * had held it. The phone stays linked.
   *
   * @returns When link attached the local preview.
   * @throws {Error} `[moku-editor] activeSource.useLocal: this page has no local preview.\n  Open the
   *   editor with a game (moku-editor <game>) to have one.` on a page without its own game frame.
   * @example
   * ```ts
   * await app.activeSource.useLocal(); // the Galaxy A26 stays linked; the local preview runs again
   * ```
   */
  useLocal(): Promise<void>;

  /**
   * Listens to source changes. A throwing listener is logged and does not stop the others.
   *
   * @param fn - The listener.
   * @returns Unsubscribe.
   * @example
   * ```ts
   * const reasons: string[] = [];
   * const off = app.activeSource.onChange(change => reasons.push(change.reason)); // reasons: ["connected"]
   * ```
   */
  onChange(fn: (change: SourceChange) => void): () => void;

  /**
   * The device directory connect published (`editor.devices`), undefined before the first.
   *
   * @returns The directory.
   * @example
   * ```ts
   * app.activeSource.directory()?.asking[0]; // { ticket: "p-3a1f", model: "SM-A266B", address: "192.168.1.23", link: "lan", … }
   * ```
   */
  directory(): DeviceDirectory | undefined;

  /**
   * Opens the device search: renews connect's scan lease every renewMs until the returned stop. The
   * Connect panel calls it when it opens.
   *
   * @returns Stop scanning (the lease then ends by itself after connect.leaseMs).
   * @example
   * ```ts
   * const stop = app.activeSource.scan(); // editor.devices lists the phones adb sees
   * stop(); // the panel closed
   * ```
   */
  scan(): () => void;

  /**
   * Turns device mode on for phones by wire (the adb listener; the collector reverses the port).
   *
   * @returns The listen addresses.
   * @throws {Error} The wire error of connect.wire (`port_in_use`, link closed).
   * @example
   * ```ts
   * await app.activeSource.connectWire(); // { port: 47600, adb: "127.0.0.1:47600", lan: null }
   * ```
   */
  connectWire(): Promise<ListenInfo>;

  /**
   * Turns device mode on with the LAN listener, for phones on the same Wi-Fi: the phone dials the
   * address the person types in its overlay.
   *
   * @returns The listen addresses with `lan`.
   * @throws {Error} The wire error of connect.network (`no_lan`, `port_in_use`).
   * @example
   * ```ts
   * await app.activeSource.connectNetwork(); // { port: 47600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" }
   * ```
   */
  connectNetwork(): Promise<ListenInfo>;

  /**
   * Answers a waiting pairing with the code the person typed.
   *
   * @param ticket - PairAsk.ticket.
   * @param code - What the person typed.
   * @returns Whether the phone paired (false: wrong code, the phone is refused and cools down 10 s).
   * @example
   * ```ts
   * await app.activeSource.confirmPairing("p-3a1f", "4821"); // true
   * ```
   */
  confirmPairing(ticket: string, code: string): Promise<boolean>;

  /**
   * Refuses a waiting pairing.
   *
   * @param ticket - PairAsk.ticket.
   * @returns When connect refused it.
   * @example
   * ```ts
   * await app.activeSource.refusePairing("p-3a1f"); // the phone's request is answered "refused"
   * ```
   */
  refusePairing(ticket: string): Promise<void>;

  /**
   * Turns device mode off (all phones) when this editor turned it on; with `lan`, only the LAN
   * listener.
   *
   * @param options - What to stop; absent: all of device mode.
   * @param options.lan - True to stop only the LAN listener (USB phones stay).
   * @returns When device mode (or the LAN listener) is off.
   * @throws {Error} -32007 (`unauthorized`) `not_owner` when moku-editor perf owns device mode.
   * @example
   * ```ts
   * await app.activeSource.stopDevices(); // the source falls back to the local preview (reason "stopped")
   * ```
   */
  stopDevices(options?: { readonly lan?: boolean }): Promise<void>;

  /**
   * The newest wired telemetry of the active device, undefined when the source is not a device or
   * none arrived.
   *
   * @returns The record.
   * @example
   * ```ts
   * app.activeSource.telemetry()?.memory.app; // { available: true, source: "dumpsys meminfo", value: { pid: 23811, totalPssMb: 541, … } }
   * ```
   */
  telemetry(): DeviceTelemetry | undefined;

  /**
   * Listens to the active device's telemetry records (1 Hz). Records of other devices are not
   * delivered.
   *
   * @param fn - The listener.
   * @returns Unsubscribe.
   * @example
   * ```ts
   * const off = app.activeSource.onTelemetry(record => draw(record.gpu));
   * ```
   */
  onTelemetry(fn: (record: DeviceTelemetry) => void): () => void;

  /**
   * The source changes kept for the timelines, oldest first.
   *
   * @returns A copy.
   * @example
   * ```ts
   * app.activeSource.markers().at(-1); // { at: 1791986093963, kind: "lost", label: "Galaxy A26 disconnected here · Local preview resumed", device: "d-7f3a" }
   * ```
   */
  markers(): readonly SourceMarker[];

  /**
   * The disconnect notice while it shows.
   *
   * @returns The notice or undefined.
   * @example
   * ```ts
   * app.activeSource.notice(); // { device: "d-7f3a", model: "SM-A266B", text: "Galaxy A26 disconnected. Showing the local preview.", until: 1791986105963, back: false }
   * ```
   */
  notice(): SourceNotice | undefined;

  /**
   * Closes the notice now.
   *
   * @example
   * ```ts
   * app.activeSource.dismissNotice();
   * app.activeSource.notice(); // undefined
   * ```
   */
  dismissNotice(): void;

  /**
   * Reconnect from the notice: uses the lost device's session when it is back; else waits for it (the
   * rejoin rule without a time limit) until another source is chosen.
   *
   * @returns Whether the device was back and is the source now.
   * @example
   * ```ts
   * await app.activeSource.reconnect(); // false: "Waiting for Galaxy A26…"
   * ```
   */
  reconnect(): Promise<boolean>;

  /**
   * Connects one phone adb lists: turns device mode on for wires when off, waits up to
   * connect.answerTimeoutMs for the linked device matched to that serial, then makes it the source.
   *
   * @param serial - WireDevice.serial from directory().
   * @returns When the phone is the source.
   * @throws {Error} `[moku-editor] No debug game answered on SM-A266B.\n  Start the debug build on the
   *   phone; a release build has no agent.` after the wait; "Allow USB debugging on the phone." for an
   *   unauthorized phone; connect's wire errors (`port_in_use`).
   * @example
   * ```ts
   * await app.activeSource.connectDevice("R5CX30ABCDE"); // the Galaxy A26 is the source, the local preview paused
   * ```
   */
  connectDevice(serial: string): Promise<void>;

  /**
   * What the connection bar names: the source's display name, model and link.
   *
   * @returns The label; os, browser and build come from the source's editor.perf.second (renderView reads them).
   * @example
   * ```ts
   * app.activeSource.label(); // { name: "Galaxy A26", model: "SM-A266B", kind: "device", link: { kind: "wire", transport: "adb", address: "127.0.0.1" } }
   * ```
   */
  label(): SourceLabel;

  /**
   * Link health of the active device: the hub's WebSocket ping round trip, once a second, kept in a
   * ring.
   *
   * @returns The newest latency and the ring (NaN = no sample); the local preview has latencyMs null.
   * @example
   * ```ts
   * app.activeSource.health(); // { kind: "wire", latencyMs: 9, samples: Float32Array(48), head: 17 }
   * ```
   */
  health(): SourceHealth;

  /**
   * Phone epoch − computer epoch in ms, estimated from the device's heartbeats and the ping round
   * trip (midpoint), the median of the last 8 beats. Maps computer-time telemetry onto the phone's
   * clock.
   *
   * @returns The offset; 0 for the local preview; null before two beats of a device.
   * @example
   * ```ts
   * app.activeSource.clockOffsetMs(); // -412: the phone's clock is 412 ms behind this computer's
   * ```
   */
  clockOffsetMs(): number | null;

  /**
   * Asks the Render workspace to open its Connect panel (the top-bar pill calls it): emits
   * `activeSource:connect-requested`.
   *
   * @param tab - Which way to show first.
   * @example
   * ```ts
   * app.activeSource.openConnect("network"); // Render shows, its Connect panel open on "On the network"
   * ```
   */
  openConnect(tab?: "wire" | "network"): void;
};

/**
 * Domain context of activeSource: the kernel context is assignable to it. `emit` sends the plugin's
 * own per-plugin events.
 */
export type ActiveSourceCtx = {
  readonly config: Readonly<ActiveSourceConfig>;
  state: ActiveSourceState;
  readonly emit: EmitFn<ActiveSourceEvents>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * The teardown context of activeSource's onStop: own config and state, no emit, no log (spec/08 §2).
 */
export type ActiveSourceStopCtx = {
  readonly config: Readonly<ActiveSourceConfig>;
  state: ActiveSourceState;
};

/**
 * activeSource's hook: the global `link:status`, to adopt a choice made elsewhere (B8).
 */
export type ActiveSourceHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
};
