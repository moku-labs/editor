/**
 * @file gameView plugin — the strip of the stage the Element panel covers while it floats open as
 * a drawer (`game.side` in overlay mode, below 600 px of Game body). The stage clips the docked
 * game frame to the part left of it (Stage `[data-part="clip"]`): the frame layer sits above the
 * workspace (D-14), so unclipped it would paint over the drawer and take its pointer.
 */
import type { RefObject } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { sidePanelState, useSidePanel } from "../../panels/shared/side-panel";
import { SIDE_PANEL } from "../side";
import { drawerCover } from "../stage/geometry";

/**
 * The Element panel beside a stage: its sibling in the Game body.
 *
 * @param stage - The stage element.
 * @returns The panel element, undefined while it is closed.
 */
function drawerOf(stage: HTMLElement): HTMLElement | undefined {
  const selector = `:scope > [data-side-panel="${SIDE_PANEL}"]`;
  return stage.parentElement?.querySelector<HTMLElement>(selector) ?? undefined;
}

/**
 * The left edge of a drawer in page px: its resize handle straddles that edge, so the handle's
 * left edge when it has one.
 *
 * @param drawer - The drawer element.
 * @returns The left edge.
 */
function leftEdgeOf(drawer: HTMLElement): number {
  const left = drawer.getBoundingClientRect().left;
  const handle = drawer.querySelector<HTMLElement>(':scope > [data-part="handle"]');
  return handle === null ? left : Math.min(left, handle.getBoundingClientRect().left);
}

/**
 * The strip of the stage the drawer covers now.
 *
 * @param stage - The stage element.
 * @returns The cover in px, 0 without a drawer.
 */
function coverOf(stage: HTMLElement): number {
  const drawer = drawerOf(stage);
  return drawer === undefined ? 0 : drawerCover(stage.getBoundingClientRect(), leftEdgeOf(drawer));
}

/**
 * Follows the cover of the open drawer. The panel renders after the stage in the same pass, so the
 * first measure waits for a microtask (still before the next paint); then every size change of
 * the stage or the drawer measures again (ResizeObserver, where it exists).
 *
 * @param stage - The stage element.
 * @param onCover - Receives the cover in px.
 * @returns Stops following.
 */
function watchCover(stage: HTMLElement, onCover: (cover: number) => void): () => void {
  let observer: ResizeObserver | undefined;
  let watching = true;
  const measure = (): void => onCover(coverOf(stage));

  queueMicrotask(() => {
    if (!watching) return;

    measure();
    const drawer = drawerOf(stage);
    if (drawer === undefined || globalThis.ResizeObserver === undefined) return;

    observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(drawer);
  });

  return () => {
    watching = false;
    observer?.disconnect();
  };
}

/**
 * The px of the stage, from its right edge, the Element panel covers while it floats open as a
 * drawer; 0 while it is docked, collapsed, shut or closed. Re-renders the component on every
 * change of the panel and of the cover.
 *
 * @param stage - The stage element.
 * @returns The cover in px.
 * @example
 * ```tsx
 * const cover = useDrawerCover(root);
 * return <div data-part="clip" aria-hidden="true" style={{ right: `${cover}px` }} />;
 * ```
 */
export function useDrawerCover(stage: RefObject<HTMLElement>): number {
  const panel = useSidePanel(SIDE_PANEL);
  const floating = panel.expanded && sidePanelState(SIDE_PANEL).overlay;
  const [cover, setCover] = useState(0);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!floating || element === null) {
      setCover(0);
      return;
    }

    return watchCover(element, setCover);
  }, [floating, stage]);

  return cover;
}
