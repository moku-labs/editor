/**
 * @file renderView device strip — the D1 instrument strip (design-context §6 A1, §7): the header
 * bar ("Devices · N connected · Performance", "Browser · …" on a browser session), the device
 * row, and the main grid — on the left the headline of the last second, the wide frame graph
 * with prev / next, More (open by default) and the legend row; on the right the spike record
 * side panel. One dark cockpit theme in both tools themes (its tokens live on the strip's scope).
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../../link";
import type { LinkStatus } from "../../../registry/protocol";
import type { RenderViewCtx } from "../../types";
import { headline, moreText } from "../derive";
import type { DeviceStripView, StripLine } from "../types";
import { deviceView, setMore } from "../watch";
import { DeviceRow } from "./DeviceRow";
import { Legend } from "./Legend";
import { SpikePanel } from "./SpikePanel";
import { StripGraph } from "./StripGraph";
import { useDeviceStrip } from "./useDeviceStrip";

/**
 * Props of `DeviceStrip`.
 */
export type DeviceStripProps = {
  readonly ctx: RenderViewCtx;
  readonly status: LinkStatus;
};

/**
 * One line of strip text: plain runs as text, values as bold spans with their tone.
 *
 * @param props - The runs.
 * @param props.line - The runs, left to right.
 * @returns The runs.
 */
function Runs(props: { readonly line: StripLine }): VNode {
  return (
    <>
      {props.line.map((run, index) =>
        run.tone === "plain" ? (
          run.text
        ) : (
          <b key={index} data-tone={run.tone} title={run.title}>
            {run.text}
          </b>
        )
      )}
    </>
  );
}

/**
 * The chevron of the More key, 16 px; the sheet turns it while More is open.
 *
 * @returns The inline SVG.
 */
function MoreChevron(): VNode {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 7l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  );
}

/**
 * The header bar: the kind of session, how many of that kind are connected, and "Performance".
 *
 * @param props - ctx and the view.
 * @param props.ctx - Domain context of renderView.
 * @param props.view - The strip view.
 * @returns The bar.
 */
function HeaderBar(props: { readonly ctx: RenderViewCtx; readonly view: DeviceStripView }): VNode {
  const browser = props.view.link.kind === "browser";
  const connected = props.ctx
    .require(linkPlugin)
    .sessions()
    .filter(session => (session.device === undefined) === browser).length;
  return (
    <header data-part="bar">
      {browser ? "Browser" : "Devices"}
      <span>{Math.max(1, connected)} connected</span>
      <span data-part="spacer" />
      <span>Performance</span>
    </header>
  );
}

/**
 * The D1 device strip. It subscribes to the strip's own notifications: a device value re-renders
 * the strip only, not the Render workspace around it.
 *
 * @param props - ctx and the link status.
 * @returns The strip; undefined while the session has none.
 */
export function DeviceStrip(props: DeviceStripProps): VNode | undefined {
  const { ctx, status } = props;
  const strip = ctx.state.device;
  const view = useDeviceStrip(strip, () => deviceView(ctx));
  if (view === undefined) return undefined;
  const stale = status.kind === "silent" || status.kind === "lost";
  const browser = view.link.kind === "browser";
  return (
    <section
      data-render="device-strip"
      data-stale={stale ? "" : undefined}
      data-perf={view.perf}
      aria-label="Device performance"
    >
      <HeaderBar ctx={ctx} view={view} />
      <DeviceRow view={view} status={status} />
      <div data-part="main">
        <div data-part="graph-column">
          <p data-part="headline">
            {headline(strip.second, strip.window, browser).map((line, index) => (
              <span key={index}>
                <Runs line={line} />
              </span>
            ))}
          </p>
          <StripGraph ctx={ctx} view={view} />
          <div data-part="more-row">
            <button
              type="button"
              data-action="more"
              aria-expanded={view.more}
              onClick={() => setMore(ctx, !view.more)}
            >
              <b>{view.more ? "Less" : "More"}</b>
              <MoreChevron />
            </button>
            <p data-part="more">
              <Runs line={moreText(strip.second, view.model, view.more)} />
            </p>
          </div>
          <Legend window={strip.window} />
        </div>
        <SpikePanel ctx={ctx} view={view} />
      </div>
    </section>
  );
}
