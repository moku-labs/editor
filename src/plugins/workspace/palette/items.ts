/**
 * @file workspace plugin — the palette index: items by id (an existing id is replaced), groups in
 * fixed order with 3 items each without a query and up to 8 with one (fuzzy only when nothing
 * matches as a substring), open/close, running an item or its ⇧↵ alt, and the built-in Commands.
 */
import { linkPlugin } from "../../link";
import { openPopover, showWorkspace, stepOnce, togglePause, togglePreview } from "../actions";
import { reloadFrame } from "../frame/reload";
import { formatCombo, isApplePlatform } from "../keys/keymap";
import { setOverlayInGame } from "../overlay";
import { chooseTheme } from "../prefs/apply";
import { effectiveTheme } from "../prefs/theme";
import type {
  PaletteGroup,
  PaletteGroupView,
  PaletteItem,
  PaletteMatch,
  WorkspaceCtx,
  WorkspaceState
} from "../types";
import { isPreviewWorkspace, WORKSPACE_IDS, WORKSPACE_LABELS } from "../workspaces";
import { fuzzyScore, scoreItem } from "./match";

/**
 * Palette groups in display order.
 *
 * @example
 * ```ts
 * GROUP_ORDER[0]; // "Commands"
 * ```
 */
export const GROUP_ORDER: readonly PaletteGroup[] = [
  "Commands",
  "Nodes",
  "Files",
  "Styles",
  "Panels",
  "Textures"
];

/**
 * Items per group without a query.
 */
const IDLE_LIMIT = 3;

/**
 * Items per group with a query.
 */
const QUERY_LIMIT = 8;

/**
 * One shown item and its match.
 */
export type ShownItem = PaletteGroupView["items"][number];

/**
 * A shown item that matched the query.
 */
type Hit = { readonly item: PaletteItem; readonly match: PaletteMatch };

/**
 * Adds one item or many; an existing id is replaced.
 *
 * @param ctx - Domain context of workspace.
 * @param items - The items.
 * @returns Removes these items (an item replaced later under the same id stays).
 */
export function addPaletteItems(
  ctx: Pick<WorkspaceCtx, "state">,
  items: PaletteItem | readonly PaletteItem[]
): () => void {
  const list: readonly PaletteItem[] = Array.isArray(items) ? items : [items];
  const index = ctx.state.palette.items;
  for (const item of list) index.set(item.id, item);
  ctx.state.ui.bump();

  return () => {
    for (const item of list) if (index.get(item.id) === item) index.delete(item.id);
    ctx.state.ui.bump();
  };
}

/**
 * The items of one group in insertion order.
 *
 * @param items - Every item.
 * @param group - The group.
 * @returns Its items.
 * @example
 * ```ts
 * ofGroup(all, "Nodes").length; // 25
 * ```
 */
function ofGroup(items: readonly PaletteItem[], group: PaletteGroup): PaletteItem[] {
  return items.filter(item => item.group === group);
}

/**
 * The scored hits of a query: substring matches, or fuzzy ones when no item of any group holds
 * the query.
 *
 * @param items - Every item.
 * @param query - What the user typed (not empty).
 * @returns The hits.
 */
function hitsOf(items: readonly PaletteItem[], query: string): Hit[] {
  const hits: Hit[] = [];
  for (const item of items) {
    const match = scoreItem(item, query);
    if (match !== undefined) hits.push({ item, match });
  }
  if (hits.length > 0) return hits;

  for (const item of items) {
    const match = fuzzyScore(item.label, query);
    if (match !== undefined) hits.push({ item, match });
  }
  return hits;
}

/**
 * The groups as shown for a query, each with its total item count.
 *
 * @param items - The palette index.
 * @param query - What the user typed.
 * @returns Non-empty groups in fixed order.
 * @example
 * ```ts
 * groupedItems(items, "merge")[0]?.group; // "Nodes" when a node matches best
 * ```
 */
export function groupedItems(
  items: ReadonlyMap<string, PaletteItem>,
  query: string
): readonly PaletteGroupView[] {
  const all = [...items.values()];
  const needle = query.trim();
  const views: PaletteGroupView[] = [];

  if (needle === "") {
    for (const group of GROUP_ORDER) {
      const list = ofGroup(all, group);
      const shown = list.slice(0, IDLE_LIMIT).map(item => ({ item, match: undefined }));
      if (list.length > 0) views.push({ group, total: list.length, items: shown });
    }
    return views;
  }

  const hits = hitsOf(all, needle);
  for (const group of GROUP_ORDER) {
    const shown = hits
      .filter(hit => hit.item.group === group)
      .toSorted((a, b) => b.match.score - a.match.score)
      .slice(0, QUERY_LIMIT);
    if (shown.length > 0) views.push({ group, total: ofGroup(all, group).length, items: shown });
  }
  return views;
}

/**
 * The shown items in display order (what ↑/↓ walk through).
 *
 * @param views - The shown groups.
 * @returns The items.
 * @example
 * ```ts
 * flatItems([{ group: "Nodes", total: 1, items: [shown] }]); // [shown]
 * ```
 */
export function flatItems(views: readonly PaletteGroupView[]): readonly ShownItem[] {
  return views.flatMap(view => view.items);
}

/**
 * Opens the palette with a query.
 *
 * @param ctx - Domain context of workspace.
 * @param query - The initial query.
 */
export function openPalette(ctx: Pick<WorkspaceCtx, "state">, query = ""): void {
  const { palette } = ctx.state;
  palette.open = true;
  palette.query = query;
  palette.index = 0;
  ctx.state.ui.bump();
}

/**
 * Closes the palette.
 *
 * @param ctx - Domain context of workspace.
 */
export function closePalette(ctx: Pick<WorkspaceCtx, "state">): void {
  ctx.state.palette.open = false;
  ctx.state.ui.bump();
}

/**
 * Opens a closed palette, closes an open one (⌘K).
 *
 * @param ctx - Domain context of workspace.
 */
export function togglePalette(ctx: Pick<WorkspaceCtx, "state">): void {
  if (ctx.state.palette.open) closePalette(ctx);
  else openPalette(ctx);
}

/**
 * Runs an item (↵, click) or its alt (⇧↵) and closes the palette; a disabled item does not run.
 *
 * @param ctx - Domain context of workspace.
 * @param item - The item.
 * @param alt - Run the alt action.
 * @returns True when something ran.
 */
export function runPaletteItem(
  ctx: Pick<WorkspaceCtx, "state">,
  item: PaletteItem,
  alt: boolean
): boolean {
  if (item.disabled?.()) return false;
  if (alt) {
    if (item.alt === undefined) return false;
    closePalette(ctx);
    item.alt.run();
    return true;
  }
  closePalette(ctx);
  item.run();
  return true;
}

/**
 * Builds a Commands item whose label is read when shown.
 *
 * @param id - Item id.
 * @param label - Reads the label.
 * @param run - The action.
 * @param extra - Shortcut and keywords.
 * @param disabled - Reads the reason the item cannot run now (false when it can).
 * @returns The item.
 * @example
 * ```ts
 * command("cmd:retry", () => "Retry connection", () => link.retry());
 * ```
 */
function command(
  id: string,
  label: () => string,
  run: () => void,
  extra: Pick<PaletteItem, "shortcut" | "keywords"> = {},
  disabled?: () => string | false
): PaletteItem {
  return {
    id,
    group: "Commands",
    ...extra,
    ...(disabled === undefined ? {} : { disabled }),
    /**
     * The label of the current state.
     *
     * @returns The label.
     * @example
     * ```ts
     * item.label; // "Pause the game"
     * ```
     */
    get label() {
      return label();
    },
    run
  };
}

/**
 * The disabled reason of the commands that need a running game.
 *
 * @param state - Workspace state.
 * @returns "No game connected" or false.
 */
function needsGame(state: WorkspaceState): string | false {
  const { kind } = state.link;
  return kind === "live" || kind === "paused" ? false : "No game connected";
}

/**
 * The game commands: step, pause/resume, overlay.
 *
 * @param ctx - Domain context of workspace.
 * @returns Three items.
 */
function gameCommands(ctx: WorkspaceCtx): PaletteItem[] {
  const { state } = ctx;
  return [
    command(
      "cmd:step",
      () => "Step 1 frame",
      () => {
        stepOnce(ctx, "palette");
      },
      { shortcut: "." },
      () => (state.link.kind === "paused" ? false : "Pause the game to step frames (P)")
    ),
    command(
      "cmd:pause",
      () => (state.link.kind === "paused" ? "Resume the game" : "Pause the game"),
      () => {
        togglePause(ctx, "palette");
      },
      { shortcut: "P", keywords: "pause resume" },
      () => needsGame(state)
    ),
    command(
      "cmd:overlay",
      () => `Overlay in game ${state.overlayInGame ? "off" : "on"}`,
      () => {
        void setOverlayInGame(ctx, !state.overlayInGame, "palette");
      },
      { shortcut: "O" }
    )
  ];
}

/**
 * The shell commands: preview, theme, the six go-to items.
 *
 * @param ctx - Domain context of workspace.
 * @returns Eight items.
 */
function shellCommands(ctx: WorkspaceCtx): PaletteItem[] {
  const { state } = ctx;
  const apple = isApplePlatform(globalThis.navigator);
  const goTo = WORKSPACE_IDS.map((ws, index) =>
    command(
      `cmd:go:${ws}`,
      () => `Go to ${WORKSPACE_LABELS[ws]}`,
      () => {
        showWorkspace(ctx, ws);
      },
      { shortcut: formatCombo(`mod+${index + 1}`, apple) }
    )
  );
  return [
    command(
      "cmd:preview",
      () => {
        const { active } = state;
        if (!isPreviewWorkspace(active)) return "Show game preview";
        const verb = state.previews[active].visible ? "Hide" : "Show";
        return `${verb} game preview in ${WORKSPACE_LABELS[active]}`;
      },
      () => {
        togglePreview(ctx);
      },
      { shortcut: "G" },
      () => (state.active === "game" ? "The Game workspace always shows the game" : false)
    ),
    command(
      "cmd:theme",
      () => `Theme: ${effectiveTheme(state.theme) === "dark" ? "light" : "dark"}`,
      () => {
        chooseTheme(ctx);
      }
    ),
    ...goTo
  ];
}

/**
 * The built-in palette Commands (registered in onInit).
 *
 * @param ctx - Domain context of workspace.
 * @returns The items, in display order.
 */
export function builtInCommands(ctx: WorkspaceCtx): readonly PaletteItem[] {
  return [
    ...gameCommands(ctx),
    ...shellCommands(ctx),
    command(
      "cmd:reload",
      () => "Reload game",
      () => {
        void reloadFrame(ctx, {});
      }
    ),
    command(
      "cmd:reload-restore",
      () => "Reload game and restore state",
      () => {
        void reloadFrame(ctx, { restore: true });
      }
    ),
    command(
      "cmd:registry",
      () => "Open registry",
      () => {
        openPopover(ctx.state, "registry");
      }
    ),
    command(
      "cmd:retry",
      () => "Retry connection",
      () => {
        ctx.require(linkPlugin).retry();
      }
    )
  ];
}
