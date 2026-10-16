/**
 * @file workspace plugin — the source actions of the shell (spec 11 § 5.3 W9, W10). Every switch
 * of the page's source goes through activeSource, the one plugin that pauses and resumes the local
 * preview around it: a device session with `useDevice`, this page's own frame with `useLocal`;
 * only another game page goes to `link.choose`. Also the source pill's words, the device names of
 * the source menu, Connect device…, and the notice's Reconnect / Use.
 */
import { activeSourcePlugin } from "../activeSource";
import type { SourceLabel, SourceNotice } from "../activeSource/types";
import type { DeviceDirectory } from "../connect/protocol";
import type { SessionDevice } from "../hub/protocol";
import { linkPlugin } from "../link";
import type { SessionInfo } from "../registry/protocol";
import { closePopover, showWorkspace } from "./actions";
import type { WorkspaceCtx } from "./types";
import { capitalize } from "./ui/text";

/**
 * What the source pill shows.
 */
export type SourcePillView = {
  readonly kind: SourceLabel["kind"];
  /** "Local preview", "Galaxy A26", the game of another page. */
  readonly name: string;
  /** "by wire", "on the network", "another page"; undefined for the local preview. */
  readonly via: string | undefined;
  /** The source's session is listed and its heartbeat is not silent. */
  readonly live: boolean;
};

/**
 * How a device reaches the editor, in words.
 *
 * @param link - The device's link.
 * @returns "by wire" over adb, "on the network" over the LAN.
 * @example
 * ```ts
 * linkWords("adb"); // "by wire"
 * ```
 */
export function linkWords(link: SessionDevice["link"]): string {
  return link === "adb" ? "by wire" : "on the network";
}

/**
 * The source pill's words and dot: the label's name, how the source is reached, and whether its
 * session is there and heard.
 *
 * @param label - activeSource.label().
 * @param session - The source's session in link.sessions(), undefined when not listed.
 * @returns The view.
 * @example
 * ```ts
 * const label: SourceLabel = { name: "Galaxy A26", model: "SM-A266B", kind: "device",
 *   link: { kind: "wire", transport: "adb", address: "127.0.0.1" } };
 * sourcePill(label, undefined); // { kind: "device", name: "Galaxy A26", via: "by wire", live: false }
 * ```
 */
export function sourcePill(label: SourceLabel, session: SessionInfo | undefined): SourcePillView {
  let via: string | undefined;
  if (label.kind === "device") via = label.link.kind === "wire" ? "by wire" : "on the network";
  else if (label.kind === "page") via = "another page";
  const live = session !== undefined && session.heartbeat?.silent !== true;
  return { kind: label.kind, name: label.name, via, live };
}

/**
 * The name of a linked device in the source menu: the marketing name adb matched to it, else its
 * model, else "The device".
 *
 * @param device - The device of a session.
 * @param directory - connect's directory, when one arrived.
 * @returns The name.
 * @example
 * ```ts
 * const phone: SessionDevice = { id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1",
 *   port: 47600, engine: null, build: null };
 * deviceName(phone, undefined); // "SM-A266B"
 * ```
 */
export function deviceName(device: SessionDevice, directory: DeviceDirectory | undefined): string {
  const matched = directory?.wire.find(phone => phone.device === device.id)?.name;
  return capitalize(matched ?? device.model ?? "the device");
}

/**
 * Makes a session the page's source, through activeSource for a device and for this page's own
 * frame (so the local preview is paused and resumed around the switch), through link only for
 * another game page.
 *
 * @param ctx - Domain context of workspace.
 * @param session - The chosen session.
 * @returns When the switch is done.
 */
export function switchSource(ctx: WorkspaceCtx, session: SessionInfo): Promise<unknown> {
  const source = ctx.require(activeSourcePlugin);
  const link = ctx.require(linkPlugin);
  if (session.device !== undefined) return source.useDevice(session.id);
  if (session.id === link.ownSession()) return source.useLocal();
  return link.choose(session.id);
}

/**
 * Picks a session from a menu (the session menu, the source menu): `switchSource`, a failure is a
 * warn.
 *
 * @param ctx - Domain context of workspace.
 * @param session - The chosen session.
 */
export function chooseSource(ctx: WorkspaceCtx, session: SessionInfo): void {
  switchSource(ctx, session).catch((error: unknown) => {
    ctx.log.warn("workspace:choose-failed", { session: session.id, error: String(error) });
  });
}

/**
 * Connect device… of the source menu: closes the menu, shows Render and asks activeSource to open
 * the Connect panel there (`activeSource:connect-requested`).
 *
 * @param ctx - Domain context of workspace.
 */
export function openConnectPanel(ctx: WorkspaceCtx): void {
  closePopover(ctx.state, "source");
  showWorkspace(ctx, "render");
  ctx.require(activeSourcePlugin).openConnect();
}

/**
 * The notice's button: Reconnect for a device that is gone (activeSource then waits for it), Use
 * for one that is back. reconnect() rejoins a lost device that is back; a device that only linked
 * while another was the source ("connected — Use") has nothing to rejoin, so its newest session is
 * used.
 *
 * @param ctx - Domain context of workspace.
 * @param notice - The notice that shows.
 * @returns When the device is the source, or activeSource waits for it.
 */
export async function answerNotice(ctx: WorkspaceCtx, notice: SourceNotice): Promise<void> {
  const source = ctx.require(activeSourcePlugin);
  const back = await source.reconnect();
  if (back || !notice.back) return;

  const session = ctx
    .require(linkPlugin)
    .sessions()
    .filter(item => item.device?.id === notice.device)
    .toSorted((left, right) => right.connectedAt - left.connectedAt)[0];
  if (session !== undefined) await source.useDevice(session.id);
}

/**
 * Runs the notice's button and repaints at once (Reconnect's waiting text) and when it settled; a
 * failure is a warn.
 *
 * @param ctx - Domain context of workspace.
 * @param notice - The notice that shows.
 */
export function reconnectFromNotice(ctx: WorkspaceCtx, notice: SourceNotice): void {
  const { state } = ctx;
  answerNotice(ctx, notice)
    .catch((error: unknown) => {
      ctx.log.warn("workspace:reconnect-failed", { device: notice.device, error: String(error) });
    })
    .finally(() => {
      state.ui.bump();
    });
  state.ui.bump();
}

/**
 * The notice's Dismiss: closes it now.
 *
 * @param ctx - Domain context of workspace.
 */
export function dismissNotice(ctx: WorkspaceCtx): void {
  ctx.require(activeSourcePlugin).dismissNotice();
  ctx.state.ui.bump();
}

/**
 * Splits a notice's text into its bold first sentence and the rest (design S6: "**Galaxy A26
 * disconnected.** Showing the local preview."). A text of one sentence has no bold part.
 *
 * @param text - SourceNotice.text.
 * @returns The bold lead (with its period) and the rest (with its leading space).
 * @example
 * ```ts
 * noticeParts("Galaxy A26 disconnected. Showing the local preview.");
 * // { lead: "Galaxy A26 disconnected.", rest: " Showing the local preview." }
 * ```
 */
export function noticeParts(text: string): { readonly lead: string; readonly rest: string } {
  const end = text.indexOf(". ");
  if (end === -1) return { lead: "", rest: text };
  return { lead: text.slice(0, end + 1), rest: text.slice(end + 1) };
}
