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
 * `PointerEvent.button` of the primary (left) button.
 */
const PRIMARY_BUTTON = 0;

/**
 * `PointerEvent.button` of the middle button: a press with it always pans.
 */
const MIDDLE_BUTTON = 1;

/**
 * The hit element under an event target.
 *
 * @param target - The event target.
 * @returns The closest element with `data-hit`, or undefined.
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
 */
function inChrome(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-chrome]") !== null;
}

/**
 * True for an event on a native control inside the world (a frame's Collapse and Enter, a card's
 * expand toggle). The canvas must not start a gesture there: its pointer capture would take the
 * `click` away from the control.
 *
 * @param target - The event target.
 * @returns Whether the target is a control with its own click.
 */
function onControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("button, a[href], input, select, textarea") !== null
  );
}

/**
 * True for a press the canvas leaves alone: a button other than the primary or the middle one,
 * a press inside the canvas chrome or on a native control in the world.
 *
 * @param event - The pointerdown.
 * @returns Whether the canvas ignores the press.
 */
function isIgnoredPress(event: PointerEvent): boolean {
  const isPrimaryOrMiddle = event.button === PRIMARY_BUTTON || event.button === MIDDLE_BUTTON;
  return !isPrimaryOrMiddle || inChrome(event.target) || onControl(event.target);
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
 * Props of the world layer.
 */
type WorldProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly world: WorldView;
  readonly drag: Drag | undefined;
  readonly hover: string | undefined;
};

/**
 * The element of one world item, looked up by key in the card, hub, stub and note views. A port
 * draws as a dot (entry) or a labelled tag (exit).
 *
 * @param props - The world layer props.
 * @param item - The item, already moved when it is the dragged one.
 * @returns The element, or false for an item the world does not draw.
 */
function renderItem(props: WorldProps, item: Item): VNode | false {
  const { ctx, actions, world } = props;

  // A node card or a hub: the views that take the actions.
  const card = world.cards.get(item.key);
  if (card !== undefined) {
    return <NodeCard key={item.key} ctx={ctx} actions={actions} item={item} view={card} />;
  }
  const hub = world.hubs.get(item.key);
  if (hub !== undefined) {
    return <Hub key={item.key} ctx={ctx} actions={actions} item={item} view={hub} />;
  }

  // A stub or a note: read-only views; a note shows its selection.
  const stub = world.stubs.get(item.key);
  if (stub !== undefined) return <Stub key={item.key} item={item} view={stub} />;
  const note = world.notes.get(item.key);
  if (note !== undefined) {
    const isSelected = ctx.state.focus.selected === item.key;
    return <NoteNode key={item.key} item={item} view={note} selected={isSelected} />;
  }

  // A port: an entry dot or a labelled exit tag; anything else is not drawn.
  if (item.kind !== "port") return false;
  const isEntry = item.key.endsWith("entry");
  return (
    <span
      key={item.key}
      data-flow="port"
      data-kind={isEntry ? "entry" : "exit"}
      title={item.label}
      style={{ left: `${item.x}px`, top: `${item.y}px` }}
    >
      {isEntry ? "" : item.label}
    </span>
  );
}

/**
 * The world layer.
 *
 * @param props - Context, actions, the world view, the drag and the hovered stub.
 * @returns The world element.
 */
function World(props: WorldProps): VNode {
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
      {result.items.map(original => renderItem(props, byKey[original.key] ?? original))}
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
  // The hit of the last two presses: a double-click enters what its FIRST press was on, because
  // that press selects the item and the focus camera moves it away from under the pointer.
  const presses = useRef<{ readonly hit: string | undefined; readonly key: string | undefined }[]>(
    []
  );
  const [drag, setDrag] = useState<Drag>();
  const [hover, setHover] = useState<string>();

  // Keep the camera's viewport size in step with the canvas box.
  useEffect(() => {
    const element = canvas.current;
    if (element === undefined) return;
    /**
     * Records the canvas size when it has one.
     */
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      const hasSize = rect.width > 0 && rect.height > 0;
      if (hasSize) actions.camera.setView({ w: rect.width, h: rect.height });
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [actions, canvas]);

  // Wheel and pinch pan or zoom; a non-passive listener so the page does not scroll.
  useEffect(() => {
    const element = canvas.current;
    if (element === undefined) return;
    /**
     * Pans or zooms on a wheel or pinch inside the canvas only.
     *
     * @param event - The wheel event.
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

  // Track the Space key: while it is held, a drag pans.
  useEffect(() => {
    /**
     * Space held outside a text field: drags pan.
     *
     * @param event - The keydown.
     */
    const down = (event: KeyboardEvent): void => {
      if (event.code === "Space" && !isTextField(event.target)) space.current = true;
    };
    /**
     * Space released.
     *
     * @param event - The keyup.
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

  // While a drag is live, Esc cancels it ahead of the workspace Esc layers.
  useEffect(() => {
    if (drag === undefined) return;
    /**
     * Esc during a drag puts the item back before the Esc layers see the key.
     *
     * @param event - The keydown.
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

  // Write the camera transform once the first world is on screen.
  useLayoutEffect(() => {
    if (world !== undefined) actions.camera.apply();
  }, [actions, world === undefined]);

  // A press starts a gesture: a drag on a card or note, otherwise a pan.
  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (isIgnoredPress(event)) return;
      const element = hitOf(event.target);
      const name = element?.dataset.hit;
      presses.current = [...presses.current.slice(-1), { hit: name, key: element?.dataset.key }];
      const hit: HitTarget = name === undefined ? "canvas" : (HITS[name] ?? "canvas");
      const key = element?.dataset.key;
      const item = key === undefined ? undefined : world?.result.byKey[key];
      const movable = item?.kind === "node" || item?.kind === "note";
      const pan = event.button === MIDDLE_BUTTON || space.current || !movable;
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

  // A move pans the camera, or moves the dragged item once past the drag threshold.
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

  // A release drops a moved item, or else selects or clears like a click.
  const onPointerUp = useCallback(() => {
    const current = gesture.current;
    gesture.current = undefined;
    setDrag(undefined);
    if (current === undefined || current.cancelled) return;
    const item = current.key === undefined ? undefined : world?.result.byKey[current.key];
    const isDropOfMovedItem =
      current.mode === "drag" && current.moved >= DRAG_THRESHOLD && item !== undefined;
    if (isDropOfMovedItem) {
      const x = item.x + current.dx;
      const y = item.y + current.dy;
      if (item.kind === "note") actions.layout.dropNote(item.id, item.flow, x, y);
      else actions.layout.drop(item.key, x, y);
      return;
    }
    const intent = releaseIntent(current.moved, current.hit, current.key);
    if (intent?.kind === "select") actions.focus.select(intent.key);
    if (intent?.kind === "clear") actions.focus.leave();
  }, [actions, world]);

  // A double-click on a card or a frame head enters it.
  const onDoubleClick = useCallback(
    (event: MouseEvent) => {
      if (inChrome(event.target)) return;
      // The canvas holds the pointer capture, so the target is the canvas: use the first press.
      const first = presses.current.length === 2 ? presses.current[0] : undefined;
      const element = hitOf(event.target);
      const press = first ?? { hit: element?.dataset.hit, key: element?.dataset.key };
      if (press.key !== undefined && entersOnDoubleClick(press.hit)) actions.flows.enter(press.key);
    },
    [actions]
  );

  // A right click opens the node, outcome or canvas menu at the pointer.
  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      if (inChrome(event.target)) return;
      event.preventDefault();

      // Where the menu opens, in canvas px, and what was hit.
      const element = hitOf(event.target);
      const rect = canvas.current?.getBoundingClientRect();
      const x = event.clientX - (rect?.left ?? 0);
      const y = event.clientY - (rect?.top ?? 0);
      const hit = element?.dataset.hit;
      const key = element?.dataset.key;

      // A card, the hub head or a note opens the node menu.
      if (opensNodeMenu(hit) && key !== undefined) {
        actions.focus.openMenu({ target: "node", key, outcome: undefined, x, y });
        return;
      }

      // A stub or outcome row opens the outcome menu; a stub reads its outcome off the edge into it.
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

      // Anything else opens the canvas menu.
      actions.focus.openMenu({ target: "canvas", key: undefined, outcome: undefined, x, y });
    },
    [actions, canvas, world]
  );

  // Hovering a stub draws its return edge.
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
