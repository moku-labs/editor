/**
 * @file overlay plugin — type definitions: config, constants, state, the painted view, the api,
 * the domain context and the plugin context.
 */
import type { Log } from "@moku-labs/common/browser";
import type { AgentEvents, Require } from "../../config";
import type {
  CommandDescriptor,
  EditorChannel,
  LinkStatus,
  Manifest,
  RunState
} from "../registry/protocol";
import type { CommandEntry } from "../registry/types";

/**
 * Repaint cadence while open.
 */
export const PAINT_MS = 250;

/**
 * How long a cheat button shows ✓.
 */
export const OK_MS = 1200;

/**
 * How long a cheat button shows !.
 */
export const ERROR_MS = 3000;

/**
 * z-index of the host.
 */
export const Z_INDEX = 2_147_483_000;

/**
 * The attribute that marks the host element. It lives in the protocol, so the bridge's tap watch
 * reads the same marker; re-exported here for `Overlay.*`.
 */
export { HOST_ATTRIBUTE } from "../registry/protocol";

/**
 * The corner of the game page the card sits in.
 */
export type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left";

/**
 * Overlay configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { registry: { game }, overlay: { open: true, corner: "bottom-left" } } });
 * ```
 */
export type Config = {
  /** Open at start. False by default; a QA build sets true. */
  open: boolean;
  /** Corner of the game page. Default "top-right". */
  corner: Corner;
  /** CSS selector of the element the host is appended to; undefined = document.body. */
  mount: string | undefined;
};

/**
 * The numbers of `game.render` the overlay shows.
 */
export type RenderNumbers = {
  readonly fps: number;
  readonly frameMs: number;
  readonly textureMb: number;
};

/**
 * The last result of one cheat button.
 */
export type CheatResult = {
  readonly ok: boolean;
  readonly message: string | undefined;
  readonly at: number;
};

/**
 * Overlay state.
 */
export type OverlayState = {
  open: boolean;
  host: HTMLElement | undefined;
  root: ShadowRoot | undefined;
  hasBridge: boolean;
  link: LinkStatus | undefined;
  session: string | undefined;
  render: RenderNumbers | undefined;
  renderUnavailable: boolean;
  stopRender: (() => void) | undefined;
  paintTimer: ReturnType<typeof setInterval> | undefined;
  busy: Set<string>;
  results: Map<string, CheatResult>;
  cheats: readonly CommandDescriptor[];
  isolate: ((event: Event) => void) | undefined;
};

/**
 * One render chip.
 */
export type RenderChip = {
  readonly key: "fps" | "frame" | "textures" | "render";
  readonly text: string;
  readonly title: string | undefined;
};

/**
 * One cheat button as painted.
 */
export type CheatView = {
  readonly id: string;
  readonly title: string;
  readonly state: "idle" | "busy" | "ok" | "error";
  readonly message: string | undefined;
};

/**
 * Everything OverlayCard paints (pure output of viewOf).
 */
export type OverlayView = {
  readonly corner: Corner;
  readonly link: { readonly kind: LinkStatus["kind"]; readonly label: string } | undefined;
  readonly chips: readonly RenderChip[];
  readonly cheats: readonly CheatView[];
  readonly announce: string;
};

/**
 * The overlay api (`app.overlay`): switches the in-game card on and off. The `editor.overlay`
 * command does the same from the tools page.
 */
export type OverlayApi = {
  /**
   * Shows the card: render numbers and the game's one-click cheats. Before start it only sets
   * the flag, and onStart honours it. Idempotent.
   *
   * @example
   * ```ts
   * // A QA shortcut switches the card on.
   * app.overlay.open(); // the card appears in the top-right corner of the game page
   * app.overlay.isOpen(); // true
   * ```
   */
  open(): void;
  /**
   * Hides the card and stops the render watch and the repaint interval. Idempotent.
   *
   * @example
   * ```ts
   * // Hide the card before a screenshot.
   * app.overlay.close();
   * app.overlay.isOpen(); // false
   * ```
   */
  close(): void;
  /**
   * Whether the overlay is switched on.
   *
   * @returns The flag; false by default, true with `pluginConfigs.overlay.open`.
   * @example
   * ```ts
   * app.overlay.isOpen(); // false: the overlay is off by default
   * ```
   */
  isOpen(): boolean;
};

/**
 * Domain context of the overlay modules (unit tests pass a plain object).
 */
export type OverlayCtx = {
  readonly config: Readonly<Config>;
  state: OverlayState;
  readonly log: Log.LogApi;
  readonly registry: {
    manifest(): Manifest;
    add(entry: CommandEntry): void;
    envelope(): RunState;
  };
  readonly channel: { watch: EditorChannel["watch"]; run: EditorChannel["run"] };
};

/**
 * Plugin context of the overlay: the kernel context is assignable to it.
 */
export type OverlayPluginCtx = {
  readonly config: Readonly<Config>;
  state: OverlayState;
  readonly log: Log.LogApi;
  readonly require: Require;
  readonly has: (name: string) => boolean;
};

/**
 * The overlay's hooks.
 */
export type OverlayHooks = {
  readonly "bridge:status": (payload: AgentEvents["bridge:status"]) => void;
};
