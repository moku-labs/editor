/**
 * @file flowView plugin — the preview zone of the Flow canvas: where the workspace floats the
 * pinned game preview. It stays clear of the canvas chrome (camera.previewZone) and of the
 * Inspector while that floats open over the canvas as a drawer. The zone is registered again on
 * every change of the Inspector panel and every resize of the canvas, so the preview follows a
 * resize, a collapse or a close at once.
 */
import { clampWidth, sidePanelState, subscribeSidePanel } from "../panels/shared/side-panel/store";
import type { Insets, WorkspaceApi } from "../workspace/types";
import { drawerInset } from "./camera/chrome";
import { INSPECTOR_MAX_W, INSPECTOR_MIN_W, inspectorWidth } from "./inspector/size";
import { INSPECTOR_PANEL } from "./keys";
import type { FlowActions, FlowCtx } from "./types";

/**
 * The elements of the zone: the Flow workspace (the drawer's container) and its canvas.
 */
export type ZoneElements = { readonly root: HTMLElement; readonly canvas: HTMLElement };

/**
 * The width of the Inspector while it floats open over the canvas as a drawer: the person's width
 * or the default, inside the bounds (SidePanel).
 *
 * @param ctx - Domain context of flowView.
 * @returns The width in px; undefined while the Inspector is docked, shut or closed.
 */
function openDrawerWidth(ctx: FlowCtx): number | undefined {
  const panel = sidePanelState(INSPECTOR_PANEL);
  if (panel.closed || !panel.overlay || !panel.drawer) return undefined;

  const width = panel.width ?? inspectorWidth(ctx.state.inspector.tab);
  return clampWidth(width, INSPECTOR_MIN_W, INSPECTOR_MAX_W);
}

/**
 * The insets of the zone now: the canvas chrome, and on the right the part of the canvas an open
 * Inspector drawer covers.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param elements - The Flow workspace and its canvas.
 * @returns The insets in px.
 */
function zoneInsets(ctx: FlowCtx, actions: FlowActions, elements: ZoneElements): Insets {
  const canvas = elements.canvas.getBoundingClientRect();
  const chrome = actions.camera.previewZone({ w: canvas.width, h: canvas.height });
  const container = elements.root.getBoundingClientRect();
  const right = drawerInset(canvas, container, openDrawerWidth(ctx));

  return right > 0 ? { ...chrome, right } : chrome;
}

/**
 * Makes the canvas the Flow preview zone and keeps the preview in step with it: registered again
 * on every change of the Inspector panel (open, shut, resize, collapse, close) and every resize
 * of the canvas, so the workspace places the preview again at once.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param workspace - The workspace api (its previewZone).
 * @param elements - The Flow workspace and its canvas.
 * @returns Stops following and removes the zone.
 */
export function followPreviewZone(
  ctx: FlowCtx,
  actions: FlowActions,
  workspace: Pick<WorkspaceApi, "previewZone">,
  elements: ZoneElements
): () => void {
  const insets = (): Insets => zoneInsets(ctx, actions, elements);

  // A newer zone replaces the older one, so only the newest remover matters.
  let remove = workspace.previewZone("flow", elements.canvas, insets);
  const refresh = (): void => {
    remove = workspace.previewZone("flow", elements.canvas, insets);
  };

  const stopPanel = subscribeSidePanel(INSPECTOR_PANEL, refresh);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : undefined;
  observer?.observe(elements.canvas);

  return () => {
    stopPanel();
    observer?.disconnect();
    remove();
  };
}
