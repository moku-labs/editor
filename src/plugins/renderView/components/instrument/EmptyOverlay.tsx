/**
 * @file renderView components (instrument) — what the timeline shows instead of frames (spec 09 § M9
 * States, § M19): nothing running (Start local preview, Connect device), waiting for the first frames
 * (with the link's latency), no frame monitor (the probe's reason), an agent before the Mission
 * control feeds. A centred card over the plot, clear of the gutter and the axis.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { linkPlugin } from "../../../link";
import { openConnect, startLocal } from "../../actions/connect";
import { healthText } from "../../derive/connection";
import type { MissionOverlay } from "../../derive/states";
import { overlayOf, overlayText } from "../../derive/states";
import { listed } from "../../source/listed";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { Spinner } from "../parts";
import { start } from "../start";

/**
 * Props of `EmptyOverlay`.
 */
export type EmptyOverlayProps = { readonly ctx: RenderViewCtx };

/**
 * The overlay the timeline shows now.
 *
 * @param ctx - Domain context of renderView.
 * @returns The overlay; undefined when the timeline shows frames.
 * @example
 * ```ts
 * timelineOverlay(ctx); // "waiting" before the phone's first frames
 * ```
 */
export function timelineOverlay(ctx: RenderViewCtx): MissionOverlay {
  const { mission } = ctx.state;
  const source = mission.source ?? ctx.require(activeSourcePlugin).current();
  const manifest = ctx.require(linkPlugin).manifest();
  const second = mission.second;
  return overlayOf({
    started: !(source.kind === "local" && source.session === null),
    second: second !== undefined && second.state !== "waiting" && mission.history.count > 0,
    monitored: listed(manifest, "editor.perf.second"),
    feeds: listed(manifest, "editor.perf.frames"),
    sectionOn: true
  });
}

/**
 * The overlay over the timeline; nothing while it shows frames.
 *
 * @param props - ctx.
 * @returns The overlay, or nothing.
 */
export function EmptyOverlay(props: EmptyOverlayProps): JSX.Element | null {
  const { ctx } = props;
  const overlay = timelineOverlay(ctx);
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (overlay === undefined) return null;
  const activeSource = ctx.require(activeSourcePlugin);
  const label = activeSource.label();
  const by = label.link.kind === "network" ? "on Wi-Fi" : "by wire";
  const offText =
    ctx
      .require(linkPlugin)
      .manifest()
      ?.sources.find(entry => entry.id === "editor.perf.second")?.reason ?? "";
  const text = overlayText(overlay, {
    name: label.name,
    link: `${healthText(activeSource.health())} ${by}`,
    offText
  });
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (text === undefined) return null;
  return (
    <div data-overlay={overlay}>
      <div data-part="card">
        {overlay === "waiting" ? <Spinner /> : undefined}
        <b>{text.title}</b>
        {text.body === "" ? undefined : <p>{text.body}</p>}
        {overlay === "not-started" ? (
          <div data-part="row">
            <button
              type="button"
              data-variant="outline"
              data-action="start-local"
              onClick={() => start(ctx, startLocal(ctx))}
            >
              <MissionIcon name="play" size={14} />
              Start local preview
            </button>
            <button
              type="button"
              data-variant="primary"
              data-action="connect"
              onClick={() => openConnect(ctx)}
            >
              Connect device
            </button>
          </div>
        ) : undefined}
      </div>
    </div>
  );
}
