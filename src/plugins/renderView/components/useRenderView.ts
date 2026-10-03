/**
 * @file renderView plugin — the Preact hook of the Render workspace: re-renders a component on
 * every `notify(state)` and returns what it selects.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import { subscribe } from "../state";
import type { RenderViewState } from "../types";

/**
 * Subscribes the component to renderView state and returns the selected value of this render.
 * The subscription is a layout effect: it runs before paint, so a `notify` right after the first
 * render is not lost.
 *
 * @param state - renderView state.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 */
export function useRenderView<T>(state: RenderViewState, select: () => T): T {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => subscribe(state, () => setVersion(version => version + 1)), [state]);
  return select();
}
