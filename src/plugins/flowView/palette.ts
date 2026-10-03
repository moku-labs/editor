/**
 * @file flowView plugin — the palette items flowView adds to the workspace palette (E1): the static
 * Commands, the Nodes group (replaced when the graph changes; ⇧↵ "Open in Files") and the Styles
 * group (replaced whenever stylesFile is read).
 */
import { workspacePlugin } from "../workspace";
import type { PaletteGroup, PaletteItem } from "../workspace/types";
import type { FlowActions, FlowCtx } from "./types";

/**
 * Builds one palette item.
 *
 * @param id - Item id.
 * @param group - Palette group.
 * @param label - Label.
 * @param run - What Enter does.
 * @param extra - mono, hint, alt, disabled.
 * @returns The item.
 * @example
 * ```ts
 * paletteItem("flow:fit-all", "Commands", "Fit all", () => actions.camera.fitAll());
 * ```
 */
function paletteItem(
  id: string,
  group: PaletteGroup,
  label: string,
  run: () => void,
  extra: Partial<Pick<PaletteItem, "mono" | "hint" | "alt" | "disabled" | "shortcut">> = {}
): PaletteItem {
  return { id, group, label, run, ...extra };
}

/**
 * The world point at the viewport centre (where a free note opens).
 *
 * @param ctx - Domain context of flowView.
 * @returns World coordinates.
 */
export function viewportCentre(ctx: FlowCtx): { x: number; y: number } {
  const { cam, viewport } = ctx.state.camera;
  return { x: (viewport.w / 2 - cam.x) / cam.z, y: (viewport.h / 2 - cam.y) / cam.z };
}

/**
 * Opens a node's file in Files (⇧↵ of a Nodes item), or toasts that there is none.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param id - The node id.
 * @returns Resolves when the event is emitted or the toast shown.
 */
export async function openNodeFile(ctx: FlowCtx, actions: FlowActions, id: string): Promise<void> {
  const file = await actions.inspector.fileOf(id);
  if (file === undefined) ctx.require(workspacePlugin).toast("No file found for this node");
  else actions.inspector.openInFiles(file.path, file.line);
}

/**
 * The ⇧↵ action of a Nodes item.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param id - The node id.
 * @returns The action.
 */
function opener(ctx: FlowCtx, actions: FlowActions, id: string): () => void {
  return () => {
    openNodeFile(ctx, actions, id).catch(() => {});
  };
}

/**
 * The static Commands of flowView.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @returns The items.
 */
export function commandItems(ctx: FlowCtx, actions: FlowActions): PaletteItem[] {
  /**
   * Shows the Flow workspace.
   */
  const show = (): void => {
    ctx.require(workspacePlugin).show("flow");
  };
  /**
   * The reason Reset layout is disabled (M8).
   *
   * @returns The reason, or false when something is pinned.
   * @example
   * ```ts
   * resetDisabled(); // "Nothing is pinned in the visible flows"
   * ```
   */
  const resetDisabled = (): string | false =>
    actions.layout.pinnedCount() === 0 ? "Nothing is pinned in the visible flows" : false;
  return [
    paletteItem("flow:fit-all", "Commands", "Fit all", () => actions.camera.fitAll(), {
      shortcut: "F"
    }),
    paletteItem(
      "flow:fit-selection",
      "Commands",
      "Fit selection",
      () => actions.camera.fitSelection(),
      {
        shortcut: "⇧2"
      }
    ),
    paletteItem("flow:follow", "Commands", "Follow the game", () => actions.camera.follow()),
    paletteItem(
      "flow:reset-layout",
      "Commands",
      "Reset layout",
      () => {
        actions.layout.reset().catch((error: unknown) => {
          ctx.log.warn("flowView: reset layout failed", { message: String(error) });
        });
      },
      { disabled: resetDisabled }
    ),
    paletteItem(
      "flow:add-note",
      "Commands",
      "Add a note",
      () => {
        show();
        actions.notes.edit({ anchor: viewportCentre(ctx) });
      },
      { shortcut: "N" }
    ),
    paletteItem("flow:go-to-current", "Commands", "Go to current node", () => {
      show();
      actions.focus.select(actions.focus.current());
    })
  ];
}

/**
 * Replaces the Nodes group: one item per node (label = node id), Enter focuses it, ⇧↵ opens its
 * file in Files.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 */
export function setNodeItems(ctx: FlowCtx, actions: FlowActions): void {
  const { palette } = ctx.state.view;
  palette.nodes?.();
  palette.nodes = undefined;
  const { graph } = ctx.state.data;
  if (graph === undefined) return;

  const workspace = ctx.require(workspacePlugin);
  const items: PaletteItem[] = [];
  for (const [flow, flowJson] of Object.entries(graph.flows)) {
    for (const node of Object.keys(flowJson.nodes)) {
      const id = `${flow}/${node}`;
      items.push(
        paletteItem(
          `flow:node:${id}`,
          "Nodes",
          id,
          () => {
            workspace.show("flow");
            actions.focus.select(id);
          },
          { mono: true, alt: { label: "Open in Files", run: opener(ctx, actions, id) } }
        )
      );
    }
  }
  palette.nodes = workspace.palette.add(items);
}

/**
 * Replaces the Styles group: one item per text-style key of stylesFile; running one shows Flow and
 * opens the Styles tab on that key's card.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param keys - The text-style keys.
 */
export function setStyleItems(ctx: FlowCtx, actions: FlowActions, keys: readonly string[]): void {
  const { palette } = ctx.state.view;
  palette.styles?.();
  palette.styles = undefined;
  if (keys.length === 0) return;

  const workspace = ctx.require(workspacePlugin);
  const items = keys.map(key =>
    paletteItem(`flow:style:${key}`, "Styles", key, () => {
      workspace.show("flow");
      actions.inspector.openStyles(key).catch(() => {});
    })
  );
  palette.styles = workspace.palette.add(items);
}
