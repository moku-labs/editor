/**
 * @file renderView plugin — the Render workspace, "Mission control" (spec 09 § Delta 2026-10-16, §
 * M15 Layout): the connection bar over both columns; the left column with the frames card, the sync
 * note, the cards, the Shaders & passes panel, the static facts and the collapsible Scene details;
 * the inspector on the right (under the instrument on a narrow page). The root is the `render` size
 * container, carries the source's tint (`data-src`) and the stale mark while the link is silent or
 * lost, and runs the paint loop while Render is shown. Esc clears the selection once no popover is
 * open.
 */
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { activeSourcePlugin } from "../../activeSource";
import type { LinkStatus } from "../../registry/protocol";
import type { WorkspaceApi } from "../../workspace/types";
import { startLoop } from "../timeline/loop";
import type { RenderViewCtx } from "../types";
import { CardsGrid } from "./cards/CardsGrid";
import { StaticFacts } from "./cards/StaticFacts";
import { SyncNote } from "./cards/SyncNote";
import { ConnectionBar } from "./connection/ConnectionBar";
import { sourceKindOf } from "./connection/SourcePill";
import { Inspector } from "./inspector/Inspector";
import { FramesCard } from "./instrument/FramesCard";
import { PassesPanel } from "./passes/PassesPanel";
import { SceneDetails } from "./scene/SceneDetails";
import { useMission, useMissionApi } from "./useMission";

/**
 * Props of `RenderWorkspace`.
 */
export type RenderWorkspaceProps = {
  readonly ctx: RenderViewCtx;
  readonly status: LinkStatus;
  readonly workspace: WorkspaceApi;
};

/**
 * The Render workspace.
 *
 * @param props - ctx, the link status of this render and the workspace api.
 * @returns The workspace.
 */
export function RenderWorkspace(props: RenderWorkspaceProps): JSX.Element {
  const { ctx, status, workspace } = props;
  const { state } = ctx;
  const { mission } = state;
  const api = useMissionApi(ctx);
  const root = useRef<HTMLDivElement>(null);
  const active = useMission(mission, () => state.active);
  const source = mission.source ?? ctx.require(activeSourcePlugin).current();
  const stale = status.kind === "silent" || status.kind === "lost";

  useEffect(() => {
    const element = root.current;
    if (!active || element === null) return;
    const stop = startLoop(ctx, element);
    mission.stopLoop = stop;
    return () => {
      stop();
      if (mission.stopLoop === stop) mission.stopLoop = undefined;
    };
  }, [active, ctx, mission]);

  useEffect(() => {
    const element = root.current;
    if (!active || element === null) return;
    const document = element.ownerDocument;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      const inside =
        target instanceof Node && (element.contains(target) || target === document.body);
      if (!inside || mission.popover !== undefined || mission.selection === undefined) return;
      event.preventDefault();
      // eslint-disable-next-line unicorn/no-useless-undefined -- select(undefined) clears the selection (the api's contract)
      api.select(undefined);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, api, mission]);

  return (
    <div
      ref={root}
      data-render="workspace"
      data-src={sourceKindOf(source)}
      data-stale={stale ? "" : undefined}
    >
      <h1 data-visually-hidden>Render</h1>
      <ConnectionBar ctx={ctx} status={status} workspace={workspace} />
      <div data-part="body">
        <div data-part="main">
          <FramesCard ctx={ctx} api={api} />
          <SyncNote ctx={ctx} />
          <CardsGrid ctx={ctx} api={api} />
          <PassesPanel ctx={ctx} api={api} />
          <StaticFacts ctx={ctx} />
          <SceneDetails ctx={ctx} workspace={workspace} />
        </div>
        <Inspector ctx={ctx} api={api} />
      </div>
    </div>
  );
}
