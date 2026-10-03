/**
 * @file consoleView plugin — the Preact hook of the Console: re-renders a component on every
 * change the api reports and returns what it selects.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import type { ConsoleApi } from "../types";

/**
 * Subscribes the component to the console api and returns the selected value of this render.
 * The subscription is a layout effect: it runs before paint, so a change reported right after the
 * first render is not lost.
 *
 * @param api - The console api.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 */
export function useConsole<T>(api: ConsoleApi, select: () => T): T {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => api.subscribe(() => setVersion(version => version + 1)), [api]);
  return select();
}
