/**
 * @file renderView components (connection) — the health line under the source's name (spec 09 §
 * M7): a device's pulsing dot, its 72 × 14 latency sparkline (painted by the loop from
 * activeSource.health(), `data-paint="health"`), the newest latency and how it is linked ("by wire,
 * USB", "by wire, Wi-Fi debugging", "on the network"); the local preview's calm dot and "In this
 * editor window". A silent link reads "silent {s} s".
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import type { LinkStatus } from "../../../registry/protocol";
import { healthText, linkWords } from "../../derive/connection";
import type { RenderViewCtx } from "../../types";
import { useTicker } from "../useMission";

/**
 * Props of `HealthLine`.
 */
export type HealthLineProps = { readonly ctx: RenderViewCtx; readonly status: LinkStatus };

/**
 * The health line.
 *
 * @param props - ctx and the link status.
 * @returns The line.
 */
export function HealthLine(props: HealthLineProps): JSX.Element {
  const { ctx, status } = props;
  const activeSource = ctx.require(activeSourcePlugin);
  const source = ctx.state.mission.source ?? activeSource.current();
  const device = source.kind === "device";
  useTicker(1000, device || status.kind === "silent");
  const label = activeSource.label();
  const wireless =
    source.kind === "device" &&
    activeSource.directory()?.wire.find(phone => phone.device === source.device.id)?.transport ===
      "wifi";
  const words = linkWords(source, label, wireless);
  if (status.kind === "silent" || status.kind === "lost") {
    const silent =
      status.kind === "silent"
        ? `silent ${Math.max(0, Math.round((Date.now() - status.since) / 1000))} s`
        : "link lost";
    return (
      <p data-health data-state="silent">
        <span data-dot="warn" />
        <span>{silent}</span>
        <span>{words}</span>
      </p>
    );
  }
  if (!device) {
    return (
      <p data-health data-state="calm">
        <span data-dot="calm" />
        <span>{words}</span>
      </p>
    );
  }
  return (
    <p data-health data-state="live">
      <span data-dot="live" />
      <canvas data-paint="health" />
      <span data-latency>{healthText(activeSource.health())}</span>
      <span>{words}</span>
    </p>
  );
}
