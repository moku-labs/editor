/**
 * @file consoleView plugin — the Preact hook of the Console: re-renders a component on every
 * change the api reports and returns what it selects; and the preview zone of the log area.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import type { WorkspaceApi } from "../../workspace/types";
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

/**
 * The part of the workspace api the preview zone needs.
 */
export type ZoneHost = Pick<WorkspaceApi, "previewZone">;

/**
 * Keeps the floating game preview inside the log area, so it never covers the detail drawer below
 * it. The zone is registered again on every size change of the area (the drawer opening, closing
 * or growing, a window resize), which places the float again.
 *
 * @param workspace - The workspace api.
 * @param element - The log area (`[data-body]`), undefined before it renders.
 * @returns Removes the zone and stops observing.
 * @example
 * ```ts
 * const stop = keepPreviewInLogArea(app.workspace, body); // the float sits above the drawer
 * stop();
 * ```
 */
export function keepPreviewInLogArea(
  workspace: ZoneHost,
  element: HTMLElement | undefined
): () => void {
  if (element === undefined) return () => {};

  let remove = workspace.previewZone("console", element);
  const observer =
    globalThis.ResizeObserver === undefined
      ? undefined
      : new ResizeObserver(() => {
          const previous = remove;
          remove = workspace.previewZone("console", element);
          previous();
        });
  observer?.observe(element);
  return () => {
    observer?.disconnect();
    remove();
  };
}
