/**
 * @file flowView render module — the context menus (D4) on a node, an outcome (edge label, port,
 * stub) and the empty canvas: `role="menu"` in the browser top layer (`popover`, M7), first item
 * focused, ↑/↓ move, Enter runs, Esc closes (workspace Esc layer contextMenu), flipped to stay inside
 * the canvas. Step 1 frame is disabled unless paused (M5); Reset layout while nothing is pinned (M8).
 */
import type { VNode } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { splitId } from "../focus/graph";
import type { MenuState } from "../focus/types";
import type { FlowActions, FlowCtx, NodeId } from "../types";
import { useElement, useFlowStore } from "../useFlowStore";

/**
 * One menu item.
 */
export type MenuItem = {
  readonly label: string;
  readonly run: () => void;
  readonly disabled: boolean;
};

/**
 * Props of `ContextMenu`.
 */
export type ContextMenuProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * Width kept for the menu when it flips.
 */
const MENU_W = 220;

/**
 * Height of one item when the menu flips.
 */
const ITEM_H = 30;

/**
 * Builds one item.
 *
 * @param label - The label.
 * @param run - What it does.
 * @param disabled - Whether it is disabled.
 * @returns The item.
 * @example
 * ```ts
 * menuItem("Fit all", () => actions.camera.fitAll());
 * ```
 */
function menuItem(label: string, run: () => void, disabled = false): MenuItem {
  return { label, run, disabled };
}

/**
 * The node id a menu key names: the laid-out item's id, else the key's last `>` segment.
 *
 * @param ctx - Domain context of flowView.
 * @param key - The menu's item key.
 * @returns The node id "<flow>/<node>".
 */
function menuNodeId(ctx: FlowCtx, key: string): NodeId {
  return ctx.state.layout.result?.byKey[key]?.id ?? key.slice(key.lastIndexOf(">") + 1);
}

/**
 * The items of a node menu.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param key - The node's item key.
 * @returns The items.
 */
function nodeItems(ctx: FlowCtx, actions: FlowActions, key: string): MenuItem[] {
  // Resolve the graph node behind the menu key.
  const id = menuNodeId(ctx, key);
  const { flow, node: name } = splitId(id);
  const node = ctx.state.data.graph?.flows[flow]?.nodes[name];

  // Every node: focus it, or focus it and open the Code or Styles tab.
  const items = [
    menuItem("Focus", () => actions.focus.select(key)),
    menuItem("Open code", () => {
      actions.focus.select(key);
      actions.inspector.setTab("code");
    }),
    menuItem("Open styles", () => {
      actions.focus.select(key);
      actions.inspector.setTab("styles");
    })
  ];

  // A container (sub-flow or slot): expand or collapse it in place, and enter a sub-flow.
  if (node?.subFlow !== undefined || node?.slot !== undefined) {
    const expanded = ctx.state.layout.expanded.has(key);
    items.push(
      expanded
        ? menuItem("Collapse", () => actions.flows.collapse(key))
        : menuItem("Expand", () => actions.flows.expand(key))
    );
  }
  const subFlow = node?.subFlow;
  if (subFlow !== undefined)
    items.push(menuItem(`Enter ${subFlow}`, () => actions.flows.enter(key)));

  // One "Add note" per outcome of the node.
  for (const outcome of node?.outcomes ?? []) {
    items.push(
      menuItem(`Add note on ${outcome}`, () => actions.notes.edit({ from: { node: id, outcome } }))
    );
  }

  // The node the game is on: step one frame (paused only), pause or resume.
  if (actions.focus.current() === id) {
    const isPaused = actions.focus.isPaused();
    items.push(
      menuItem(
        "Step 1 frame",
        () => {
          if (isPaused) actions.focus.step().catch(() => {});
        },
        !isPaused
      ),
      isPaused
        ? menuItem("Resume game", () => {
            actions.focus.resume().catch(() => {});
          })
        : menuItem("Pause game", () => {
            actions.focus.pause().catch(() => {});
          })
    );
  }
  return items;
}

/**
 * The items of a menu.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param menu - The open menu.
 * @returns The items in order.
 */
export function menuItems(ctx: FlowCtx, actions: FlowActions, menu: MenuState): MenuItem[] {
  const { key, outcome } = menu;
  if (menu.target === "node" && key !== undefined) return nodeItems(ctx, actions, key);
  const isOutcomeMenu = menu.target === "outcome" && key !== undefined && outcome !== undefined;
  if (isOutcomeMenu) {
    const id = menuNodeId(ctx, key);
    const { flow, node: name } = splitId(id);
    const raw = ctx.state.data.graph?.flows[flow]?.edges[name]?.[outcome] ?? "";
    const target = raw.startsWith("map:") ? raw.slice("map:".length) : raw;
    const items = [
      menuItem("Add note on this outcome", () =>
        actions.notes.edit({ from: { node: id, outcome } })
      )
    ];
    if (target !== "") {
      items.push(
        menuItem(`Focus ${target}`, () => {
          if (!target.startsWith("exit:")) actions.focus.select(`${flow}/${target}`);
        })
      );
    }
    return items;
  }
  const { cam } = ctx.state.camera;
  const anchor = { x: (menu.x - cam.x) / cam.z, y: (menu.y - cam.y) / cam.z };
  return [
    menuItem("Add note here", () => actions.notes.edit({ anchor })),
    menuItem("Fit all", () => actions.camera.fitAll()),
    menuItem(
      "Reset layout",
      () => {
        actions.layout.reset().catch((error: unknown) => {
          ctx.log.warn("flowView: reset layout failed", { message: String(error) });
        });
      },
      actions.layout.pinnedCount() === 0
    )
  ];
}

/**
 * The context menu.
 *
 * @param props - Context and actions.
 * @returns The menu, or an empty fragment when none is open.
 */
export function ContextMenu(props: ContextMenuProps): VNode {
  const { ctx, actions } = props;
  const menu = useFlowStore(ctx, state => state.focus.menu);
  const element = useElement<HTMLDivElement>();

  useLayoutEffect(() => {
    const node = element.current;
    if (node === undefined) return;
    if (typeof node.showPopover === "function") {
      try {
        node.showPopover();
      } catch {
        // Already shown.
      }
    }
    node.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu, element]);

  if (menu === undefined) return <span data-closed="context-menu" hidden />;
  const items = menuItems(ctx, actions, menu);
  const canvas = ctx.state.view.root
    ?.querySelector('[data-flow="canvas"]')
    ?.getBoundingClientRect();
  const width = canvas?.width ?? ctx.state.camera.viewport.w;
  const height = canvas?.height ?? ctx.state.camera.viewport.h;
  const menuHeight = items.length * ITEM_H;
  const flipsLeft = menu.x + MENU_W > width && menu.x > MENU_W;
  const flipsUp = menu.y + menuHeight > height && menu.y > menuHeight;
  const x = flipsLeft ? menu.x - MENU_W : menu.x;
  const y = flipsUp ? menu.y - menuHeight : menu.y;

  /**
   * Runs an enabled item and closes the menu.
   *
   * @param item - The item.
   */
  const run = (item: MenuItem): void => {
    if (item.disabled) return;
    actions.focus.closeMenu();
    item.run();
  };

  return (
    <div
      data-flow="context-menu"
      data-chrome=""
      popover="manual"
      role="menu"
      ref={element.ref}
      style={{ left: `${(canvas?.left ?? 0) + x}px`, top: `${(canvas?.top ?? 0) + y}px` }}
      onKeyDown={event => {
        const buttons = [
          ...(element.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
        ];
        const index = buttons.indexOf(event.target as HTMLElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          buttons[(index + step + buttons.length) % buttons.length]?.focus();
        } else if (event.key === "Enter") {
          event.preventDefault();
          const item = items[index];
          if (item !== undefined) run(item);
        }
      }}
    >
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-disabled={item.disabled ? "true" : undefined}
          onClick={() => run(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
