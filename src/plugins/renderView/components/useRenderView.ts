/**
 * @file renderView plugin — the Preact hook of the Render workspace: re-renders a component on
 * every `notify(state)` and returns what it selects.
 */
import { useEffect, useState } from "preact/hooks";
import { subscribe } from "../state";
import type { RenderViewState } from "../types";

/**
 * Subscribes the component to renderView state and returns the selected value of this render.
 *
 * @param state - renderView state.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 * @example
 * ```tsx
 * const snapshot = useRenderView(ctx.state, () => deriveSnapshot(ctx.state));
 * ```
 */
export function useRenderView<T>(state: RenderViewState, select: () => T): T {
  const [, setVersion] = useState(0);
  useEffect(() => subscribe(state, () => setVersion(version => version + 1)), [state]);
  return select();
}
