/**
 * @file stateView plugin — `useTracker`: re-renders a component on every tracker change
 * (commit, reset, taint, graph, expansion) and returns the last commit of this render.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import type { LastCommit, StateViewApi } from "../types";

/**
 * Subscribes the component to `api.onCommit` and returns the last commit. The subscription is a
 * layout effect: it runs before paint, so a change right after the first render is not lost.
 *
 * @param api - The stateView api.
 * @returns The last commit, or undefined.
 */
export function useTracker(api: StateViewApi): LastCommit | undefined {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => api.onCommit(() => setVersion(version => version + 1)), [api]);
  return api.lastCommit();
}
