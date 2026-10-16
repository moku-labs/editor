/**
 * @file renderView components (connection) — the source pill (spec 09 § M7): the device or laptop
 * icon on its `--src` tile, the source's name with its status tag, the sub line (a device's model, or
 * the local preview's browser "in this editor window") and the health line. `data-kind` names the
 * source (device, local, page, none) for the stripe's tint and for the e2e hooks.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import type { LinkStatus } from "../../../registry/protocol";
import { statusTag, subLine } from "../../derive/connection";
import type { ActiveSource } from "../../source/contract";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { Tag } from "../parts";
import { HealthLine } from "./HealthLine";

/**
 * Props of `SourcePill`.
 */
export type SourcePillProps = { readonly ctx: RenderViewCtx; readonly status: LinkStatus };

/**
 * The kind of a source as the bar's tint reads it: a local preview without a session is "none".
 *
 * @param source - The active source.
 * @returns device, local, page or none.
 * @example
 * ```ts
 * sourceKindOf({ kind: "local", session: null }); // "none"
 * ```
 */
export function sourceKindOf(source: ActiveSource): "device" | "local" | "page" | "none" {
  if (source.kind === "local" && source.session === null) return "none";
  return source.kind;
}

/**
 * The source pill.
 *
 * @param props - ctx and the link status.
 * @returns The pill.
 */
export function SourcePill(props: SourcePillProps): JSX.Element {
  const { ctx, status } = props;
  const { mission } = ctx.state;
  const activeSource = ctx.require(activeSourcePlugin);
  const source = mission.source ?? activeSource.current();
  const label = activeSource.label();
  return (
    <div data-source-pill data-kind={sourceKindOf(source)}>
      <span data-part="tile">
        <MissionIcon name={source.kind === "device" ? "phone" : "laptop"} size={22} />
      </span>
      <div data-part="text">
        <p data-part="name">
          <span data-source-name>{label.name}</span>
          <Tag tag={statusTag(source, mission.second)} />
        </p>
        <p data-part="sub">{subLine(source, label, mission.second)}</p>
        <HealthLine ctx={ctx} status={status} />
      </div>
    </div>
  );
}
