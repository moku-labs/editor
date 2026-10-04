/**
 * @file Shared view module — side-panel: the SidePanel every view docks its side panel with
 * (finding 2, D-29), and the `useSidePanel` hook a view's reopen button reads. Resize handle on
 * the inner edge (pointer, ←/→, double-click), collapse to a 32 px rail, close and reopen, and a
 * floating drawer when the parent container is narrower than `overlayBelow`.
 */
import type { ComponentChildren, JSX, RefObject, VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { SidePanelState } from "./store";
import {
  clampWidth,
  showSidePanel,
  sidePanelState,
  subscribeSidePanel,
  toggleSidePanel,
  updateSidePanel
} from "./store";

/**
 * Props of a SidePanel.
 *
 * @example
 * ```tsx
 * <SidePanel id="flow.inspector" side="end" title="Inspector" defaultWidth={320} minWidth={220} maxWidth={560} overlayBelow={600}>
 *   <Inspector ctx={ctx} />
 * </SidePanel>
 * ```
 */
export type SidePanelProps = {
  /** The persistence key: localStorage `moku-editor:panel:<id>`. */
  readonly id: string;
  /** The edge of the view it docks to; the resize handle sits on the other edge. */
  readonly side: "start" | "end";
  /** Shown in the head and the collapsed rail; the aria-label of the panel. */
  readonly title: string;
  /** The width in px until the person resizes it. */
  readonly defaultWidth: number;
  /** The smallest width a drag or a key gives. */
  readonly minWidth: number;
  /** The largest width a drag or a key gives. */
  readonly maxWidth: number;
  /** Container width in px below which the panel floats over the content; never without it. */
  readonly overlayBelow?: number;
  /** Controlled open: the owner decides; uncontrolled (the store's `closed`) when absent. */
  readonly open?: boolean;
  /** Told when the close button asks to close (false). */
  readonly onOpenChange?: (open: boolean) => void;
  /** The panel content; it stays mounted while the panel is collapsed. */
  readonly children?: ComponentChildren;
};

/**
 * What a view needs of a side panel for its reopen button and its palette item.
 *
 * @example
 * ```tsx
 * const inspector = useSidePanel("flow.inspector");
 * if (inspector.closed) return <button type="button" data-action="reopen-flow.inspector" onClick={inspector.show}>Inspector</button>;
 * ```
 */
export type SidePanelHandle = {
  /** The panel is closed: show the reopen button. */
  readonly closed: boolean;
  /** The panel shows its content (docked expanded, or the drawer open). */
  readonly expanded: boolean;
  /** Shows the panel expanded (showSidePanel). */
  readonly show: () => void;
  /** Collapses or expands it; shows it when closed (toggleSidePanel). */
  readonly toggle: () => void;
};

/**
 * Props of the resize handle: the panel's id, side, title and bounds, the width shown now and the
 * setter of the live width of a drag (undefined when it ends).
 */
type HandleProps = Pick<SidePanelProps, "id" | "side" | "title" | "minWidth" | "maxWidth"> & {
  readonly width: number;
  readonly onLive: (width?: number) => void;
};

/**
 * A resize in progress: where the press started, the width then and the width now.
 */
type Drag = { readonly startX: number; readonly startWidth: number; width: number };

/**
 * The step of ←/→ on the focused handle, in px.
 */
const KEY_STEP = 16;

/**
 * Tells whether the panel shows its content: the drawer in overlay mode, else not collapsed.
 *
 * @param state - The panel state.
 * @returns True when expanded.
 * @example
 * ```ts
 * isExpanded({ width: undefined, collapsed: false, closed: false, overlay: true, drawer: false }); // false
 * ```
 */
function isExpanded(state: SidePanelState): boolean {
  return state.overlay ? state.drawer : !state.collapsed;
}

/**
 * Re-renders the component on every change of a panel's state and returns the state.
 *
 * @param id - The panel id.
 * @returns The state of this render.
 */
function useSidePanelState(id: string): SidePanelState {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => subscribeSidePanel(id, () => setVersion(version => version + 1)), [id]);
  return sidePanelState(id);
}

/**
 * The state of a side panel for its view: closed or expanded, with show and toggle. The view
 * renders the reopen button (`data-action="reopen-<id>"`) while `closed`; it re-renders on every
 * change of the panel.
 *
 * @param id - The panel id.
 * @returns The handle.
 * @example
 * ```tsx
 * function ReopenTree() {
 *   const tree = useSidePanel("files.tree");
 *   return tree.closed ? <button type="button" data-action="reopen-files.tree" title="Show Files" onClick={tree.show}>Files</button> : undefined;
 * }
 * ```
 */
export function useSidePanel(id: string): SidePanelHandle {
  const state = useSidePanelState(id);

  return {
    closed: state.closed,
    expanded: isExpanded(state),
    show: () => showSidePanel(id),
    toggle: () => toggleSidePanel(id)
  };
}

/**
 * Tells whether a container is narrower than the threshold; undefined while it is not laid out
 * (width 0: a hidden workspace keeps its mode).
 *
 * @param parent - The parent container.
 * @param below - The threshold in px.
 * @returns True below the threshold, undefined for width 0.
 */
function isNarrow(parent: HTMLElement, below: number): boolean | undefined {
  const width = parent.getBoundingClientRect().width;

  return width > 0 ? width < below : undefined;
}

/**
 * Keeps the panel's overlay mode in step with its parent container: measured at mount and on
 * every size change (ResizeObserver, where it exists). A narrow panel mounts collapsed unless
 * showSidePanel opened its drawer (the reopen button, the palette); entering or leaving overlay
 * mode on a resize shuts the drawer.
 *
 * @param id - The panel id.
 * @param root - The panel element, absent while closed.
 * @param overlayBelow - The threshold, undefined for never.
 * @param shown - Whether the panel renders.
 */
function useOverlay(
  id: string,
  root: RefObject<HTMLElement>,
  overlayBelow: number | undefined,
  shown: boolean
): void {
  useLayoutEffect(() => {
    const parent = root.current?.parentElement ?? undefined;

    if (!shown || parent === undefined || overlayBelow === undefined) {
      updateSidePanel(id, { overlay: false, drawer: false });
      return;
    }

    const narrow = isNarrow(parent, overlayBelow) ?? false;
    updateSidePanel(id, { overlay: narrow, drawer: narrow && sidePanelState(id).drawer });
    if (globalThis.ResizeObserver === undefined) return;

    const observer = new ResizeObserver(() => {
      const overlay = isNarrow(parent, overlayBelow);
      if (overlay === undefined || overlay === sidePanelState(id).overlay) return;

      updateSidePanel(id, { overlay, drawer: false });
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [id, root, overlayBelow, shown]);
}

/**
 * The resize handle: pointer drag (the live width shows while dragging, stored on release),
 * ←/→ steps of 16 px, double-click back to the default.
 *
 * @param props - The handle props.
 * @returns The separator element.
 */
function Handle(props: HandleProps): VNode {
  const { id, side, title, minWidth, maxWidth, width, onLive } = props;
  const drag = useRef<Drag | undefined>(undefined);
  // A move to the right widens a start panel and narrows an end panel.
  const grow = side === "end" ? -1 : 1;

  const press = (event: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, width };
    onLive(width);
  };

  const move = (event: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === undefined) return;

    const travel = event.clientX - current.startX;
    current.width = clampWidth(current.startWidth + grow * travel, minWidth, maxWidth);
    onLive(current.width);
  };

  const release = (): void => {
    const current = drag.current;
    if (current === undefined) return;

    drag.current = undefined;
    onLive();
    updateSidePanel(id, { width: current.width });
  };

  const step = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    updateSidePanel(id, {
      width: clampWidth(width + direction * grow * KEY_STEP, minWidth, maxWidth)
    });
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter (WAI-ARIA separator with a value) takes keys and pointer drags; an <hr> is a static rule
    <div
      data-part="handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${title}`}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={step}
      onDblClick={() => updateSidePanel(id, { width: undefined })}
    />
  );
}

/**
 * A side panel of a view: docked to one edge at a width the person sets, collapsible to a rail,
 * closable (the view shows the reopen button, see useSidePanel), floating over the content as a
 * drawer when its parent container is narrower than `overlayBelow`. The parent container is the
 * containing block of the drawer: views give it `position: relative`. State per panel in
 * localStorage `moku-editor:panel:<id>`; it renders right without storage.
 *
 * @param props - The panel props.
 * @returns The panel, or nothing while closed.
 * @example
 * ```tsx
 * <div data-files="layout">
 *   <SidePanel id="files.tree" side="start" title="Files" defaultWidth={272} minWidth={200} maxWidth={480} overlayBelow={600}>
 *     <Tree files={files} />
 *   </SidePanel>
 *   <Editor />
 * </div>
 * ```
 */
export function SidePanel(props: SidePanelProps): VNode | undefined {
  const { id, side, title, defaultWidth, minWidth, maxWidth, open, onOpenChange } = props;
  const state = useSidePanelState(id);
  const root = useRef<HTMLElement>(null);
  const [live, setLive] = useState<number | undefined>();
  const closed = open === undefined ? state.closed : !open;

  useOverlay(id, root, props.overlayBelow, !closed);

  if (closed) return undefined;

  // What shows: the content or the rail, at the stored (or live) width.
  const expanded = isExpanded(state);
  const width = live ?? clampWidth(state.width ?? defaultWidth, minWidth, maxWidth);
  const inward = side === "end" ? "‹" : "›";
  const outward = side === "end" ? "›" : "‹";

  const setExpanded = (next: boolean): void => {
    if (state.overlay) updateSidePanel(id, { drawer: next });
    else updateSidePanel(id, { collapsed: !next });
  };

  const close = (): void => {
    if (open === undefined) updateSidePanel(id, { closed: true });
    onOpenChange?.(false);
  };

  return (
    <aside
      ref={root}
      data-side-panel={id}
      data-side={side}
      data-state={expanded ? "expanded" : "collapsed"}
      data-overlay={state.overlay ? "" : undefined}
      data-dragging={live === undefined ? undefined : ""}
      aria-label={title}
      style={{ "--side-panel-w": `${width}px` }}
    >
      {expanded ? (
        <Handle
          key="handle"
          id={id}
          side={side}
          title={title}
          minWidth={minWidth}
          maxWidth={maxWidth}
          width={width}
          onLive={setLive}
        />
      ) : undefined}
      {expanded ? (
        <header key="head" data-part="head">
          <span data-part="title">{title}</span>
          <button
            type="button"
            data-action="collapse"
            title="Collapse (\)"
            aria-label={`Collapse ${title}`}
            aria-expanded="true"
            onClick={() => setExpanded(false)}
          >
            {outward}
          </button>
          <button
            type="button"
            data-action="close"
            title="Close"
            aria-label={`Close ${title}`}
            onClick={close}
          >
            ×
          </button>
        </header>
      ) : (
        <div key="rail" data-part="rail">
          <button
            type="button"
            data-action="expand"
            title="Expand (\)"
            aria-label={`Expand ${title}`}
            aria-expanded="false"
            onClick={() => setExpanded(true)}
          >
            {inward}
          </button>
          <span data-part="rail-title" aria-hidden="true">
            {title}
          </span>
        </div>
      )}
      <div key="body" data-part="body" hidden={!expanded}>
        {props.children}
      </div>
    </aside>
  );
}
