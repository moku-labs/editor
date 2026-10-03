/**
 * @file stateView plugin — `useTracker`: re-renders a component on every tracker change
 * (commit, reset, taint, graph, expansion) and returns the last commit of this render.
 */
import { useEffect, useState } from "preact/hooks";
import type { LastCommit, StateViewApi } from "../types";

/**
 * Subscribes the component to `api.onCommit` and returns the last commit.
 *
 * @param api - The stateView api.
 * @returns The last commit, or undefined.
 * @example
 * ```tsx
 * const last = useTracker(api); // last?.patches.length === 4 after the tap at f1503
 * ```
 */
export function useTracker(api: StateViewApi): LastCommit | undefined {
  const [, setVersion] = useState(0);
  useEffect(() => api.onCommit(() => setVersion(version => version + 1)), [api]);
  return api.lastCommit();
}
