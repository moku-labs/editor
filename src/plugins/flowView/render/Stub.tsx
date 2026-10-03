/**
 * @file flowView render module — the return stub (F8): a 120×24 dashed pill "↩ awaitIntent" at the
 * lane end; solid accent on the trail; red with "✕ rejected · frame 1778 · empty" for a rejection.
 * Hover or selection draws the full return edge (the canvas tracks the hovered stub).
 */
import type { VNode } from "preact";
import type { Item } from "../types";
import type { StubView } from "./types";

/**
 * Props of `Stub`.
 */
export type StubProps = { readonly item: Item; readonly view: StubView };

/**
 * One stub.
 *
 * @param props - The stub item and its view.
 * @returns The pill.
 * @example
 * ```tsx
 * <Stub item={stub} view={world.stubs.get(stub.key)} />
 * ```
 */
export function Stub(props: StubProps): VNode {
  const { item, view } = props;
  return (
    <div
      data-flow="stub"
      data-hit="stub"
      data-key={item.key}
      data-trail={view.trail ? "" : undefined}
      data-rejected={view.rejected === undefined ? undefined : ""}
      data-selected={view.selected ? "" : undefined}
      data-dimmed={view.dimmed ? "" : undefined}
      title={view.rejected ?? item.label}
      style={{
        left: `${item.x}px`,
        top: `${item.y}px`,
        width: `${item.w}px`,
        height: `${item.h}px`
      }}
    >
      {view.rejected ?? item.label}
    </div>
  );
}
