/**
 * @file workspace plugin — W11, the paused veil over the local game frame (spec 11 § 5.3). While a
 * device is the source and activeSource paused this page's local preview (`paused-by-source`),
 * the frame overlay shows "Paused · <name> is the source." with "Use local preview"; when the pause
 * failed (`unpausable`) it says why. The source must be a device: right after a switch back the
 * resume is still in flight and the preview still reads paused, and the veil is already gone. The
 * veil host lives in the overlay element (device space; Frame.css counter-scales its content) and
 * is repainted on `activeSource:changed` and on every session list (a pause that takes hold after
 * the change).
 */
import type { VNode } from "preact";
import { render } from "preact";
import { activeSourcePlugin } from "../../activeSource";
import type { ActiveSource, LocalPreview } from "../../activeSource/types";
import { Icon } from "../../panels/shared/icons";
import type { WorkspaceCtx } from "../types";
import { capitalize } from "../ui/text";

/**
 * What the veil shows: the paused notice or the warning of a pause that failed.
 */
export type VeilView = {
  readonly tone: "paused" | "warn";
  /** The bold first line. */
  readonly title: string;
  /** The second line. */
  readonly detail: string;
};

/**
 * What the veil shows for a source and the local preview's state.
 *
 * @param source - activeSource.current().
 * @param preview - activeSource.preview().
 * @param name - activeSource.label().name, the source's display name.
 * @returns The view; undefined while nothing veils the frame.
 * @example
 * ```ts
 * // Right after "Use local preview": the resume is in flight, the veil is already gone.
 * veilView({ kind: "local", session: "s-1" }, { state: "paused-by-source" }, "Local preview"); // undefined
 * ```
 */
export function veilView(
  source: ActiveSource,
  preview: LocalPreview,
  name: string
): VeilView | undefined {
  if (source.kind !== "device") return undefined;
  if (preview.state === "paused-by-source") {
    return { tone: "paused", title: "Paused", detail: `${capitalize(name)} is the source.` };
  }
  if (preview.state === "unpausable") {
    return { tone: "warn", title: "Could not pause the local preview", detail: preview.reason };
  }
  return undefined;
}

/**
 * The veil host of the overlay, created hidden with the overlay; `syncVeil` fills it.
 *
 * @returns The element.
 */
export function createVeil(): HTMLElement {
  const host = document.createElement("div");
  host.dataset.frameVeil = "";
  host.setAttribute("role", "status");
  host.hidden = true;
  return host;
}

/**
 * Makes the local preview the source again: activeSource.useLocal(); a failure is a warn.
 *
 * @param ctx - Domain context of workspace.
 */
function switchToLocal(ctx: Pick<WorkspaceCtx, "require" | "log">): void {
  ctx
    .require(activeSourcePlugin)
    .useLocal()
    .catch((error: unknown) => {
      ctx.log.warn("workspace:use-local-failed", { error: String(error) });
    });
}

/**
 * The content of the veil: an icon, the two lines and "Use local preview".
 *
 * @param props - The view and the button's action.
 * @param props.view - What the veil shows.
 * @param props.onUse - Makes the local preview the source.
 * @returns The content.
 */
function FrameVeil(props: { readonly view: VeilView; readonly onUse: () => void }): VNode {
  const { view } = props;
  return (
    <div data-part="box">
      <Icon name="pause" />
      <p data-part="title">{view.title}</p>
      <p data-part="detail">{view.detail}</p>
      <button type="button" data-variant="outline" data-size="sm" onClick={props.onUse}>
        Use local preview
      </button>
    </div>
  );
}

/**
 * Shows or hides the veil for the current source and local preview. Without an overlay (no frame
 * yet) there is nothing to veil.
 *
 * @param ctx - Domain context of workspace.
 */
export function syncVeil(ctx: Pick<WorkspaceCtx, "state" | "require" | "log">): void {
  const host = ctx.state.frame.overlay?.querySelector<HTMLElement>(":scope > [data-frame-veil]");
  if (host === null || host === undefined) return;

  const source = ctx.require(activeSourcePlugin);
  const view = veilView(source.current(), source.preview(), source.label().name);
  host.hidden = view === undefined;
  if (view === undefined) return;
  host.dataset.tone = view.tone;
  render(<FrameVeil view={view} onUse={() => switchToLocal(ctx)} />, host);
}
