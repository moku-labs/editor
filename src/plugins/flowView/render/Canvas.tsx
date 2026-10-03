/**
 * @file flowView render module — the Flow canvas (A1): the dot-grid clip box with the world layer
 * (frames, lanes, column heads, edges, cards, hub, stubs, notes, ports) and the pointer language of
 * design §4: wheel/pinch zoom and pan, drag on empty canvas pans, drag on a card or note moves it
 * (snap and pin on drop, Esc cancels), click selects or clears (M2), double-click enters, right
 * click opens a context menu. The camera transform is written by the camera module, not by Preact.
 */
import type { ComponentChildren, VNode } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { DRAG_THRESHOLD, isTextField, releaseIntent, wheelOp } from "../camera/input";
import type { HitTarget } from "../camera/types";
import { rerouteTouching } from "../layout/routes";
import type { EdgePath, FlowActions, FlowCtx, Item, ItemKey } from "../types";
import { useElement } from "../useFlowStore";
import { Edges, laneId } from "./Edges";
import { Frame } from "./Frame";
import { Hub } from "./Hub";
import { Lane } from "./Lane";
import { NodeCard } from "./NodeCard";
import { NoteNode } from "./NoteNode";
import { Stub } from "./Stub";
import type { WorldView } from "./types";

/**
 * Props of `Canvas`.
 */
export type CanvasProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  /** What the world draws; undefined before the first layout. */
  readonly world: WorldView | undefined;
  /** The canvas chrome (breadcrumb, toolbar, zoom bar, minimap, labels, strip). */
  readonly children?: ComponentChildren;
};

/**
 * A pointer gesture in progress.
 */
type Gesture = {
  readonly mode: "pan" | "drag";
  readonly hit: HitTarget;
  readonly key: string | undefined;
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  lastY: number;
  moved: number;
  dx: number;
  dy: number;
  cancelled: boolean;
};

/**
 * A dragged item and its world offset.
 */
type Drag = { readonly key: ItemKey; readonly dx: number; readonly dy: number };

/**
 * What a `data-hit` value means for the pointer rules.
 */
const HITS: Readonly<Record<string, HitTarget>> = {
  card: "card",
  note: "note",
  "hub-head": "hub-head",
  frame: "frame",
  "frame-head": "frame",
  lane: "lane",
  stub: "card",
  outcome: "card"
};

/**
 * The hit element under an event target.
 *
 * @param target - The event target.
 * @returns The closest element with `data-hit`, or undefined.
 * @example
 * ```ts
 * hitOf(event.target)?.dataset.hit; // "card"
 * ```
 */
function hitOf(target: EventTarget | null): HTMLElement | undefined {
  return target instanceof Element
    ? (target.closest<HTMLElement>("[data-hit]") ?? undefined)
    : undefined;
}

/**
 * True for an event inside the canvas chrome (toolbar, zoom bar, minimap, strip…), which handles
 * its own pointer input.
 *
 * @param target - The event target.
 * @returns Whether the canvas ignores the event.
 * @example
 * ```ts
 * inChrome(event.target); // true on a zoom bar button
 * ```
 */
function inChrome(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-chrome]") !== null;
}

/**
 * True for a `data-hit` a double-click enters: a card or a frame head.
 *
 * @param hit - The `data-hit` value.
 * @returns Whether a double-click enters the item.
 * @example
 * ```ts
 * entersOnDoubleClick("frame-head"); // true
 * ```
 */
function entersOnDoubleClick(hit: string | undefined): boolean {
  return hit === "card" || hit === "frame-head";
}

/**
 * True for a `data-hit` the node menu opens on: a card, the hub head or a note.
 *
 * @param hit - The `data-hit` value.
 * @returns Whether a right click opens the node menu.
 * @example
 * ```ts
 * opensNodeMenu("hub-head"); // true
 * ```
 */
function opensNodeMenu(hit: string | undefined): boolean {
  return hit === "card" || hit === "hub-head" || hit === "note";
}

/**
 * True for a `data-hit` the outcome menu opens on: a stub or an outcome row.
 *
 * @param hit - The `data-hit` value.
 * @returns Whether a right click opens the outcome menu.
 * @example
 * ```ts
 * opensOutcomeMenu("stub"); // true
 * ```
 */
function opensOutcomeMenu(hit: string | undefined): boolean {
  return hit === "stub" || hit === "outcome";
}

/**
 * The world with one item moved by a drag offset: the item and only the edges touching it change.
 *
 * @param world - The world view.
 * @param drag - The drag.
 * @returns Items by key and edges to draw.
 * @example
 * ```ts
 * dragged(world, { key: "main/home", dx: 60, dy: 30 });
 * ```
 */
function dragged(
  world: WorldView,
  drag: Drag | undefined
): { readonly byKey: Readonly<Record<ItemKey, Item>>; readonly edges: readonly EdgePath[] } {
  const { byKey, edges } = world.result;
  const item = drag === undefined ? undefined : byKey[drag.key];
  if (drag === undefined || item === undefined) return { byKey, edges };
  const moved = { ...item, x: item.x + drag.dx, y: item.y + drag.dy };
  const next = { ...byKey, [drag.key]: moved };
  return { byKey: next, edges: rerouteTouching(edges, next, drag.key).edges };
}

/**
 * The world layer.
 *
 * @param props - Context, actions, the world view, the drag and the hovered stub.
 * @param props.ctx - Domain context of flowView.
 * @param props.actions - The flowView actions.
 * @param props.world - The world view.
 * @param props.drag - The dragged item.
 * @param props.hover - The hovered stub key.
 * @returns The world element.
 */
function World(props: {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly world: WorldView;
  readonly drag: Drag | undefined;
  readonly hover: string | undefined;
}): VNode {
  const { ctx, actions, world, drag, hover } = props;
  const { result } = world;
  const { byKey, edges } = dragged(world, drag);
  const selected = ctx.state.focus.selected;
  const showReturns = new Set([hover, selected].filter(key => key !== undefined));
  return (
    <div data-flow="world" data-stale={world.stale ? "" : undefined}>
      {result.frames.map(frame => {
        const view = world.frames.get(frame.key);
        return view === undefined ? undefined : (
          <Frame key={frame.key} ctx={ctx} actions={actions} item={frame} view={view} />
        );
      })}
      {result.lanes.map(lane => (
        <Lane key={laneId(lane)} lane={lane} trail={world.trailLanes.has(laneId(lane))} />
      ))}
      {result.heads.map(head => (
        <span
          key={`${head.x}|${head.y}|${head.label}`}
          data-flow="column-head"
          style={{ left: `${head.x}px`, top: `${head.y}px` }}
        >
          {head.label}
        </span>
      ))}
      <Edges edges={edges} bounds={result.bounds} views={world.edges} showReturns={showReturns} />
      {result.items.map(original => {
        const item = byKey[original.key] ?? original;
        const card = world.cards.get(item.key);
        if (card !== undefined) {
          return <NodeCard key={item.key} ctx={ctx} actions={actions} item={item} view={card} />;
        }
        const hub = world.hubs.get(item.key);
        if (hub !== undefined)
          return <Hub key={item.key} ctx={ctx} actions={actions} item={item} view={hub} />;
        const stub = world.stubs.get(item.key);
        if (stub !== undefined) return <Stub key={item.key} item={item} view={stub} />;
        const note = world.notes.get(item.key);
        if (note !== undefined) {
          return (
            <NoteNode key={item.key} item={item} view={note} selected={selected === item.key} />
          );
        }
        if (item.kind !== "port") return false;
        return (
          <span
            key={item.key}
            data-flow="port"
            data-kind={item.key.endsWith("entry") ? "entry" : "exit"}
            title={item.label}
            style={{ left: `${item.x}px`, top: `${item.y}px` }}
          >
            {item.key.endsWith("entry") ? "" : item.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The Flow canvas.
 *
 * @param props - Context, actions, the world view and the canvas chrome.
 * @returns The canvas.
 */
export function Canvas(props: CanvasProps): VNode {
  const { ctx, actions, world, children } = props;
  const canvas = useElement<HTMLDivElement>();
  const gesture = useRef<Gesture | undefined>(undefined);
  const space = useRef(false);
  const [drag, setDrag] = useState<Drag>();
  const [hover, setHover] = useState<string>();

  useEffect(() => {
    const element = canvas.current;
    if (element === undefined) return;
    /**
     * Records the canvas size when it has one.
     */
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0)
        actions.camera.setView({ w: rect.width, h: rect.height });
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [actions, canvas]);

  useEffect(() => {
    const element = canvas.current;
    if (element === undefined) return;
    /**
     * Pans or zooms on a wheel or pinch inside the canvas only.
     *
     * @param event - The wheel event.
     * @example
     * ```ts
     * element.addEventListener("wheel", onWheel, { passive: false });
     * ```
     */
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const height = rect.height > 0 ? rect.height : ctx.state.camera.viewport.h;
      actions.camera.run(
        wheelOp(event, { x: event.clientX - rect.left, y: event.clientY - rect.top }, height)
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [actions, canvas, ctx]);

  useEffect(() => {
    /**
     * Space held outside a text field: drags pan.
     *
     * @param event - The keydown.
     * @example
     * ```ts
     * globalThis.addEventListener("keydown", down);
     * ```
     */
    const down = (event: KeyboardEvent): void => {
      if (event.code === "Space" && !isTextField(event.target)) space.current = true;
    };
    /**
     * Space released.
     *
     * @param event - The keyup.
     * @example
     * ```ts
     * globalThis.addEventListener("keyup", up);
     * ```
     */
    const up = (event: KeyboardEvent): void => {
      if (event.code === "Space") space.current = false;
    };
    globalThis.addEventListener("keydown", down);
    globalThis.addEventListener("keyup", up);
    return () => {
      globalThis.removeEventListener("keydown", down);
      globalThis.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (drag === undefined) return;
    /**
     * Esc during a drag puts the item back before the Esc layers see the key.
     *
     * @param event - The keydown.
     * @example
     * ```ts
     * globalThis.addEventListener("keydown", onEscape, { capture: true });
     * ```
     */
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || gesture.current === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      gesture.current.cancelled = true;
      setDrag(undefined);
    };
    globalThis.addEventListener("keydown", onEscape, { capture: true });
    return () => globalThis.removeEventListener("keydown", onEscape, { capture: true });
  }, [drag]);

  useLayoutEffect(() => {
    if (world !== undefined) actions.camera.apply();
  }, [actions, world === undefined]);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if ((event.button !== 0 && event.button !== 1) || inChrome(event.target)) return;
      const element = hitOf(event.target);
      const name = element?.dataset.hit;
      const hit: HitTarget = name === undefined ? "canvas" : (HITS[name] ?? "canvas");
      const key = element?.dataset.key;
      const item = key === undefined ? undefined : world?.result.byKey[key];
      const movable = item?.kind === "node" || item?.kind === "note";
      const pan = event.button === 1 || space.current || !movable;
      gesture.current = {
        mode: pan ? "pan" : "drag",
        hit,
        key,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: 0,
        dx: 0,
        dy: 0,
        cancelled: false
      };
      try {
        canvas.current?.setPointerCapture(event.pointerId);
      } catch {
        // A synthetic pointer cannot be captured; the gesture still works.
      }
    },
    [canvas, world]
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const current = gesture.current;
      if (current === undefined || current.cancelled) return;
      const dx = event.clientX - current.lastX;
      const dy = event.clientY - current.lastY;
      current.lastX = event.clientX;
      current.lastY = event.clientY;
      current.moved = Math.max(
        current.moved,
        Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
      );
      if (current.mode === "pan") {
        actions.camera.panBy(dx, dy);
        return;
      }
      if (current.moved < DRAG_THRESHOLD || current.key === undefined) return;
      const z = ctx.state.camera.cam.z;
      current.dx = (event.clientX - current.startX) / z;
      current.dy = (event.clientY - current.startY) / z;
      setDrag({ key: current.key, dx: current.dx, dy: current.dy });
    },
    [actions, ctx]
  );

  const onPointerUp = useCallback(() => {
    const current = gesture.current;
    gesture.current = undefined;
    setDrag(undefined);
    if (current === undefined || current.cancelled) return;
    const item = current.key === undefined ? undefined : world?.result.byKey[current.key];
    if (current.mode === "drag" && current.moved >= DRAG_THRESHOLD && item !== undefined) {
      if (item.kind === "note")
        actions.layout.dropNote(item.id, item.flow, item.x + current.dx, item.y + current.dy);
      else actions.layout.drop(item.key, item.x + current.dx, item.y + current.dy);
      return;
    }
    const intent = releaseIntent(current.moved, current.hit, current.key);
    if (intent?.kind === "select") actions.focus.select(intent.key);
    if (intent?.kind === "clear") actions.focus.leave();
  }, [actions, world]);

  const onDoubleClick = useCallback(
    (event: MouseEvent) => {
      if (inChrome(event.target)) return;
      const element = hitOf(event.target);
      const key = element?.dataset.key;
      if (key !== undefined && entersOnDoubleClick(element?.dataset.hit)) actions.flows.enter(key);
    },
    [actions]
  );

  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      if (inChrome(event.target)) return;
      event.preventDefault();
      const element = hitOf(event.target);
      const rect = canvas.current?.getBoundingClientRect();
      const x = event.clientX - (rect?.left ?? 0);
      const y = event.clientY - (rect?.top ?? 0);
      const hit = element?.dataset.hit;
      const key = element?.dataset.key;
      if (opensNodeMenu(hit) && key !== undefined) {
        actions.focus.openMenu({ target: "node", key, outcome: undefined, x, y });
        return;
      }
      const into =
        hit === "stub"
          ? world?.result.edges.find(edge => edge.kind === "edge" && edge.to === key)
          : undefined;
      const source = into?.from ?? element?.dataset.source ?? key;
      const outcome = into?.outcome ?? element?.dataset.outcome;
      if (opensOutcomeMenu(hit) && source !== undefined && outcome !== undefined) {
        actions.focus.openMenu({ target: "outcome", key: source, outcome, x, y });
        return;
      }
      actions.focus.openMenu({ target: "canvas", key: undefined, outcome: undefined, x, y });
    },
    [actions, canvas, world]
  );

  const onPointerOver = useCallback(
    (event: PointerEvent) => {
      const element = hitOf(event.target);
      const key = element?.dataset.hit === "stub" ? element.dataset.key : undefined;
      if (key !== hover) setHover(key);
    },
    [hover]
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: the canvas groups graph items; it is no form, so no fieldset
    <div
      data-flow="canvas"
      data-hit="canvas"
      role="group"
      aria-label="Flow graph"
      ref={canvas.ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerOver={onPointerOver}
      onDblClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {world !== undefined && (
        <World ctx={ctx} actions={actions} world={world} drag={drag} hover={hover} />
      )}
      {children}
    </div>
  );
}
