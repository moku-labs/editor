/**
 * @file flowView camera module — the minimap (B7), 200×128 bottom-right: the root flow name, every
 * item as a rect (accent = current node, note yellow = notes, frames outlined) and the viewport
 * rect; a click animates the camera centre to that world point, a drag moves the viewport live. It
 * lifts with the strip. Item rects redraw only with the layout; the viewport follows the camera.
 */
import type { VNode } from "preact";
import { useMemo, useRef } from "preact/hooks";
import type { FlowActions, FlowCtx, LayoutResult } from "../types";
import { useFlowStore } from "../useFlowStore";

/**
 * Minimap width.
 */
const MAP_W = 200;

/**
 * Minimap height.
 */
const MAP_H = 128;

/**
 * Height of the flow name line.
 */
const HEAD = 16;

/**
 * Props of `Minimap`.
 */
export type MinimapProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * The map transform of a layout: scale and offset that fit the bounds under the head line.
 *
 * @param result - The layout.
 * @returns Scale and offsets.
 * @example
 * ```ts
 * mapOf(result).scale; // 0.08
 * ```
 */
function mapOf(result: LayoutResult): {
  readonly scale: number;
  readonly ox: number;
  readonly oy: number;
} {
  const { bounds } = result;
  const scale = Math.min(MAP_W / Math.max(1, bounds.w), (MAP_H - HEAD) / Math.max(1, bounds.h));
  return {
    scale,
    ox: (MAP_W - bounds.w * scale) / 2 - bounds.x * scale,
    oy: HEAD - bounds.y * scale
  };
}

/**
 * The item rects of the minimap (memoised by the layout).
 *
 * @param props - The layout and the current item key.
 * @param props.result - The layout.
 * @param props.current - The current item key.
 * @returns The rects.
 * @example
 * ```tsx
 * <Items result={result} current={current} />
 * ```
 */
function Items(props: {
  readonly result: LayoutResult;
  readonly current: string | undefined;
}): VNode {
  const { result, current } = props;
  const rects = useMemo(() => {
    const { scale, ox, oy } = mapOf(result);
    return result.items
      .filter(item => item.kind !== "port")
      .map(item => ({
        key: item.key,
        kind: item.kind,
        x: ox + item.x * scale,
        y: oy + item.y * scale,
        w: Math.max(1, item.w * scale),
        h: Math.max(1, item.h * scale)
      }));
  }, [result]);
  return (
    <>
      {rects.map(rect => (
        <rect
          key={rect.key}
          data-minimap-item=""
          data-kind={rect.kind}
          data-current={rect.key === current ? "" : undefined}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
        />
      ))}
    </>
  );
}

/**
 * The minimap.
 *
 * @param props - Context and actions.
 * @returns The minimap, or an empty fragment before the first layout.
 * @example
 * ```tsx
 * <Minimap ctx={ctx} actions={actions} />
 * ```
 */
export function Minimap(props: MinimapProps): VNode {
  const { ctx, actions } = props;
  const result = useFlowStore(ctx, state => state.layout.result);
  const lift = useFlowStore(ctx, state => state.focus.strip);
  const current = useFlowStore(ctx, () => actions.focus.locateCurrent()?.item.key);
  const cam = useFlowStore(ctx, state => state.camera.cam, "camera");
  const press = useRef<{ moved: boolean } | undefined>(undefined);
  if (result === undefined) return <span data-closed="minimap" hidden />;
  const { scale, ox, oy } = mapOf(result);
  const { viewport } = ctx.state.camera;

  /**
   * The world point under a pointer on the map.
   *
   * @param event - The pointer event.
   * @returns World coordinates.
   * @example
   * ```ts
   * worldAt(event); // { x: 640, y: 420 }
   * ```
   */
  const worldAt = (event: PointerEvent): { x: number; y: number } => {
    const target = event.currentTarget instanceof Element ? event.currentTarget : undefined;
    const rect = target?.getBoundingClientRect();
    return {
      x: (event.clientX - (rect?.left ?? 0) - ox) / scale,
      y: (event.clientY - (rect?.top ?? 0) - oy) / scale
    };
  };

  return (
    <div data-flow="minimap" data-chrome="" data-lift={lift ? "" : undefined}>
      <svg
        width={MAP_W}
        height={MAP_H}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        role="img"
        aria-label={`Minimap of ${result.root}`}
        onPointerDown={event => {
          press.current = { moved: false };
          try {
            (event.currentTarget as Element).setPointerCapture(event.pointerId);
          } catch {
            // A synthetic pointer cannot be captured.
          }
        }}
        onPointerMove={event => {
          if (press.current === undefined) return;
          press.current.moved = true;
          const point = worldAt(event);
          actions.camera.centreOn(point.x, point.y, false);
        }}
        onPointerUp={event => {
          const pressed = press.current;
          press.current = undefined;
          if (pressed === undefined || pressed.moved) return;
          const point = worldAt(event);
          actions.camera.centreOn(point.x, point.y, true);
        }}
      >
        <text data-part="name" x={4} y={12}>
          {result.root}
        </text>
        <Items result={result} current={current} />
        <rect
          data-part="viewport"
          x={ox + (-cam.x / cam.z) * scale}
          y={oy + (-cam.y / cam.z) * scale}
          width={(viewport.w / cam.z) * scale}
          height={(viewport.h / cam.z) * scale}
        />
      </svg>
    </div>
  );
}
