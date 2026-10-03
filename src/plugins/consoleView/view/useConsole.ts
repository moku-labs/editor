/**
 * @file consoleView plugin — the Preact hook of the Console: re-renders a component on every
 * change the api reports and returns what it selects.
 */
import { useEffect, useState } from "preact/hooks";
import type { ConsoleApi } from "../types";

/**
 * Subscribes the component to the console api and returns the selected value of this render.
 *
 * @param api - The console api.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 * @example
 * ```tsx
 * const counts = useConsole(api, () => api.counts()); // { all: 8, debug: 0, info: 6, warn: 2, error: 0 }
 * ```
 */
export function useConsole<T>(api: ConsoleApi, select: () => T): T {
  const [, setVersion] = useState(0);
  useEffect(() => api.subscribe(() => setVersion(version => version + 1)), [api]);
  return select();
}
