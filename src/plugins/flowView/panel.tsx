/**
 * @file flowView plugin — the Flow panel (definePanel data, registered in onInit) and the
 * FlowWorkspace root component (composition only).
 */
import type { VNode } from "preact";
import { useEffect, useLayoutEffect } from "preact/hooks";
import { definePanel } from "../panels/define";
import type { PanelSpec, PanelTools } from "../panels/types";
import { actionsOf } from "./actions";
import { STRIP_H } from "./camera/api";
import { Minimap } from "./camera/Minimap";
import { ZoomBar } from "./camera/ZoomBar";
import { ingest } from "./data";
import { NeighboursStrip } from "./focus/NeighboursStrip";
import { Inspector } from "./inspector/Inspector";
import { NoteEditor } from "./notes/NoteEditor";
import { Breadcrumb } from "./render/Breadcrumb";
import { Canvas } from "./render/Canvas";
import { CanvasToolbar } from "./render/CanvasToolbar";
import { ContextMenu } from "./render/ContextMenu";
import { HistoryLabels, HistoryStrip } from "./render/HistoryStrip";
import { YouAreHere } from "./render/YouAreHere";
import type { FlowCommands, FlowCtx, FlowValues } from "./types";
import { useElement, useFlowStore } from "./useFlowStore";
import { historyView, infoView, worldView } from "./view-model";

/**
 * Height of the breadcrumb and toolbar band the pinned preview keeps clear of.
 */
const CHROME_TOP = 56;

/**
 * Props of the Flow workspace root.
 */
export type FlowWorkspaceProps = {
  readonly ctx: FlowCtx;
  readonly values: FlowValues;
  readonly tools: PanelTools<FlowCommands>;
};

/**
 * The Flow panel: sources game.graph, game.position, game.history {last: historyLast}; commands
 * step, pause, resume (flowView runs them through panels.run, R9).
 *
 * @param ctx - Domain context of flowView.
 * @returns The PanelSpec.
 */
export function createFlowPanel(ctx: FlowCtx): PanelSpec {
  return definePanel({
    id: "flow",
    title: "Flow",
    workspace: "flow",
    sources: {
      graph: "game.graph",
      position: "game.position",
      history: ["game.history", { last: ctx.config.historyLast }]
    },
    commands: { step: "game.step", pause: "game.pause", resume: "game.resume" },
    /**
     * Renders the Flow workspace with the panel's values and tools.
     *
     * @param values - graph, position, history.
     * @param tools - run, status, channel, files, workspace.
     * @returns The workspace element.
     */
    view: (values, tools) => <FlowWorkspace ctx={ctx} values={values} tools={tools} />
  });
}

/**
 * The Flow workspace root: takes the panel values into the state, then composes the canvas (world
 * and chrome), the Inspector, the history strip, the context menu and the note editor, passing the
 * view data by props. With the link empty it renders no world, no minimap, no "You are here" and no
 * history dots (M4): the host shows its empty card.
 *
 * @param props - Plugin context, panel values and panel tools.
 * @returns The workspace.
 */
export function FlowWorkspace(props: FlowWorkspaceProps): VNode {
  const { ctx, values, tools } = props;
  const actions = actionsOf(ctx);
  const root = useElement<HTMLDivElement>();
  useFlowStore(ctx, state => state.view.revision);

  useLayoutEffect(() => {
    ingest(ctx, values);
  }, [ctx, values.graph, values.position, values.history]);

  useLayoutEffect(() => {
    ctx.state.view.root = root.current;
    actions.camera.apply();
    return () => {
      if (ctx.state.view.root === root.current) ctx.state.view.root = undefined;
    };
  }, [ctx, actions, root]);

  const empty = ctx.state.data.status.kind === "empty";
  useEffect(() => {
    const canvas = root.current?.querySelector<HTMLElement>('[data-flow="canvas"]');
    if (canvas === undefined || canvas === null) return;
    return tools.workspace.previewZone("flow", canvas, () => ({
      top: CHROME_TOP,
      bottom: CHROME_TOP + (ctx.state.focus.strip ? STRIP_H : 0)
    }));
  }, [ctx, tools, root, empty]);

  const world = empty ? undefined : worldView(ctx, actions);
  const rows = historyView(ctx);
  const selected =
    ctx.state.focus.selected === undefined
      ? undefined
      : ctx.state.layout.result?.byKey[ctx.state.focus.selected];
  const shown =
    selected !== undefined &&
    (selected.kind === "node" || selected.kind === "hub" || selected.kind === "frame")
      ? selected.id
      : actions.focus.current();
  const info = shown === undefined ? undefined : infoView(ctx, actions, shown);

  return (
    <div data-flow="workspace" ref={root.ref} data-empty={empty ? "" : undefined}>
      {!empty && (
        <Canvas ctx={ctx} actions={actions} world={world}>
          <Breadcrumb ctx={ctx} actions={actions} />
          <CanvasToolbar ctx={ctx} actions={actions} />
          <YouAreHere ctx={ctx} actions={actions} />
          <HistoryLabels ctx={ctx} actions={actions} rows={rows} />
          <ZoomBar ctx={ctx} actions={actions} />
          <Minimap ctx={ctx} actions={actions} />
          <NeighboursStrip ctx={ctx} actions={actions} />
        </Canvas>
      )}
      <Inspector ctx={ctx} actions={actions} shown={shown} info={info} />
      {!empty && <HistoryStrip ctx={ctx} actions={actions} rows={rows} />}
      <ContextMenu ctx={ctx} actions={actions} />
      <NoteEditor ctx={ctx} actions={actions} />
    </div>
  );
}
