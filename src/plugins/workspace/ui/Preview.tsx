/**
 * @file workspace plugin — B3, the pinned game preview: a float in a corner of the workspace's
 * preview zone (12 px margin plus the zone insets), header "Game" (M/L add the device), S/M/L,
 * "Open in Game", "Hide". The header is the handle: a pointer drag on it (≥ 4 px) moves the float
 * and snaps to the nearest corner on release; Alt+arrows on it move the float a corner. The game
 * frame is docked over the body by geometry (the iframe never moves) and takes the pointer there,
 * so the preview plays the game; the size changes only through S/M/L (finding 1). Below 96 px of
 * fitted width the float collapses to its header: no body, no frame.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { Icon } from "../../panels/shared/icons";
import { presetOf, resolveDevice } from "../../registry/protocol";
import { showWorkspace } from "../actions";
import { floatRect, nearestCorner, PREVIEW_SIZES, resolveInsets } from "../frame/dock";
import { followTransitions, syncFrame } from "../frame/frame";
import { hostOf } from "../hosts";
import { patchPreview } from "../prefs/apply";
import type {
  PreviewCorner,
  PreviewPrefs,
  PreviewSize,
  PreviewWorkspace,
  RectBox,
  WorkspaceCtx
} from "../types";
import { isPreviewWorkspace } from "../workspaces";
import { useElement, useWorkspace } from "./store";

/**
 * Props of `Preview`.
 */
export type PreviewProps = { readonly ctx: WorkspaceCtx };

/**
 * Pointer travel before a press becomes a drag, in px.
 */
const DRAG_THRESHOLD = 4;

/**
 * The sizes in segmented order.
 */
const SIZES: readonly PreviewSize[] = ["S", "M", "L"];

/**
 * Where Alt+arrow moves the float from each corner.
 */
const CORNER_MOVES: Readonly<Record<string, Readonly<Record<PreviewCorner, PreviewCorner>>>> = {
  ArrowLeft: {
    "top-left": "top-left",
    "top-right": "top-left",
    "bottom-left": "bottom-left",
    "bottom-right": "bottom-left"
  },
  ArrowRight: {
    "top-left": "top-right",
    "top-right": "top-right",
    "bottom-left": "bottom-right",
    "bottom-right": "bottom-right"
  },
  ArrowUp: {
    "top-left": "top-left",
    "top-right": "top-right",
    "bottom-left": "top-left",
    "bottom-right": "top-right"
  },
  ArrowDown: {
    "top-left": "bottom-left",
    "top-right": "bottom-right",
    "bottom-left": "bottom-left",
    "bottom-right": "bottom-right"
  }
};

/**
 * A pointer press on the header.
 */
type Press = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  moved: boolean;
};

/**
 * The header's pointer handlers: press, drag and release.
 */
type DragHandlers = {
  readonly onPress: (event: PointerEvent) => void;
  readonly onDrag: (event: PointerEvent) => void;
  readonly onRelease: (event: PointerEvent) => void;
};

/**
 * The zone rect of a workspace: its registered zone element, else its host.
 *
 * @param ctx - Domain context of workspace.
 * @param ws - The workspace.
 * @returns The zone rect and its insets.
 */
function zoneOf(
  ctx: WorkspaceCtx,
  ws: PreviewWorkspace
): { rect: RectBox; insets: ReturnType<typeof resolveInsets> } {
  const zone = ctx.state.frame.zones.get(ws);
  const element = zone?.element ?? hostOf(ctx.state, ws);
  return { rect: element.getBoundingClientRect(), insets: resolveInsets(zone?.insets) };
}

/**
 * The corner Alt+arrow moves to.
 *
 * @param corner - The current corner.
 * @param key - The arrow key.
 * @returns The new corner, undefined for another key.
 * @example
 * ```ts
 * cornerAfter("bottom-right", "ArrowLeft"); // "bottom-left"
 * ```
 */
export function cornerAfter(corner: PreviewCorner, key: string): PreviewCorner | undefined {
  return CORNER_MOVES[key]?.[corner];
}

/**
 * Below this fitted width the float has no room to show the game: the body hides, the frame with
 * it, and only the header stays (for example next to a wide Inspector drawer in the 480 px pane).
 */
const MIN_BODY_WIDTH = 96;

/**
 * Places the float in its corner of the zone. A fitted width below MIN_BODY_WIDTH collapses the
 * float to its header: the body hides and the float takes the header's own size, at the same
 * corner of the room.
 *
 * @param ctx - Domain context of workspace.
 * @param section - The float element.
 * @param ws - The workspace.
 * @param prefs - Its preview prefs.
 * @param body - The body element the frame docks over.
 * @returns True when the body has room (the frame docks over it), false when collapsed.
 */
function placeFloat(
  ctx: WorkspaceCtx,
  section: HTMLElement,
  ws: PreviewWorkspace,
  prefs: PreviewPrefs,
  body: HTMLElement | undefined
): boolean {
  const { rect, insets } = zoneOf(ctx, ws);
  const float = floatRect(rect, insets, prefs.corner, PREVIEW_SIZES[prefs.size]);
  const hasRoom = float.width >= MIN_BODY_WIDTH;

  // Collapsed: no body, the header's own size.
  if (body !== undefined) body.hidden = !hasRoom;
  if (hasRoom) delete section.dataset.collapsed;
  else section.dataset.collapsed = "";
  section.style.left = `${float.left}px`;
  section.style.width = hasRoom ? `${float.width}px` : "";
  section.style.height = hasRoom ? `${float.height}px` : "";

  // A collapsed float in a bottom corner sits on the bottom edge of the room.
  const isLowHeader = !hasRoom && prefs.corner.startsWith("bottom");
  const top = isLowHeader ? float.top + float.height - section.offsetHeight : float.top;
  section.style.top = `${top}px`;
  return hasRoom;
}

/**
 * Drops a dragged float: the corner nearest to its centre, persisted.
 *
 * @param ctx - Domain context of workspace.
 * @param section - The float element.
 * @param ws - The workspace.
 * @param delta - How far it was dragged.
 * @param delta.x - Horizontal travel.
 * @param delta.y - Vertical travel.
 */
function dropFloat(
  ctx: WorkspaceCtx,
  section: HTMLElement,
  ws: PreviewWorkspace,
  delta: { readonly x: number; readonly y: number }
): void {
  const prefs = ctx.state.previews[ws];
  const { rect, insets } = zoneOf(ctx, ws);
  const float = floatRect(rect, insets, prefs.corner, PREVIEW_SIZES[prefs.size]);
  const centre = {
    x: float.left + float.width / 2 + delta.x,
    y: float.top + float.height / 2 + delta.y
  };
  section.style.transform = "";
  delete section.dataset.dragging;
  patchPreview(ctx, ws, { corner: nearestCorner(centre, rect) });
}

/**
 * The preview header, the drag handle: title, device, S/M/L, open in Game, hide.
 *
 * @param props - Context, workspace, prefs and the drag handlers.
 * @param props.ctx - Domain context of workspace.
 * @param props.ws - The workspace.
 * @param props.prefs - Its preview prefs.
 * @param props.drag - Press, drag and release handlers.
 * @returns The header.
 */
function PreviewHead(props: {
  readonly ctx: WorkspaceCtx;
  readonly ws: PreviewWorkspace;
  readonly prefs: PreviewPrefs;
  readonly drag: DragHandlers;
}): VNode {
  const { ctx, ws, prefs, drag } = props;
  const preset = presetOf(ctx.state.device.preset);
  const size = resolveDevice(preset, ctx.state.device.orientation);

  return (
    <header
      data-preview-head
      role="toolbar"
      tabIndex={0}
      aria-label="Game preview, Alt and an arrow key move it"
      onPointerDown={drag.onPress}
      onPointerMove={drag.onDrag}
      onPointerUp={drag.onRelease}
      onKeyDown={event => {
        const corner = event.altKey ? cornerAfter(prefs.corner, event.key) : undefined;
        if (corner === undefined) return;
        event.preventDefault();
        patchPreview(ctx, ws, { corner });
      }}
    >
      <span data-title>Game</span>
      {prefs.size !== "S" && (
        <span data-device data-mono>{`${preset.name} · ${size.w}×${size.h}`}</span>
      )}
      <span data-segmented role="radiogroup" aria-label="Preview size">
        {SIZES.map(option => (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons, styled as one group
          <button
            type="button"
            role="radio"
            key={option}
            aria-checked={prefs.size === option}
            onClick={() => patchPreview(ctx, ws, { size: option })}
          >
            {option}
          </button>
        ))}
      </span>
      <button
        type="button"
        data-variant="ghost"
        data-size="sm"
        title="Open in Game (⌘1)"
        aria-label="Open in Game"
        onClick={() => showWorkspace(ctx, "game")}
      >
        <Icon name="open" />
      </button>
      <button
        type="button"
        data-variant="ghost"
        data-size="sm"
        title="Hide (G)"
        aria-label="Hide the game preview"
        onClick={() => patchPreview(ctx, ws, { visible: false })}
      >
        <Icon name="hide" />
      </button>
    </header>
  );
}

/**
 * The pinned game preview.
 *
 * @param props - The workspace domain context.
 * @returns The float (hidden in Game and while the preview of the workspace is hidden).
 */
export function Preview(props: PreviewProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const section = useElement<HTMLElement>();
  const body = useElement<HTMLDivElement>();
  const [press] = useState<{ current: Press | undefined }>(() => ({ current: undefined }));
  const { active } = state;
  const ws = isPreviewWorkspace(active) ? active : undefined;
  const prefs = ws === undefined ? undefined : state.previews[ws];
  const shown = prefs?.visible === true;

  useLayoutEffect(() => {
    const element = section.current;
    const isPlaceable = shown && element !== undefined && ws !== undefined && prefs !== undefined;
    const hasRoom = isPlaceable && placeFloat(ctx, element, ws, prefs, body.current);
    state.frame.previewBody = hasRoom ? body.current : undefined;
    syncFrame(ctx);
  });
  useLayoutEffect(() => {
    const element = section.current;
    const stop = element === undefined ? undefined : followTransitions(ctx, element);
    return () => {
      stop?.();
      state.frame.previewBody = undefined;
    };
  }, [ctx, section, state]);

  if (ws === undefined || prefs === undefined || !shown) {
    return <section data-ui="preview" hidden ref={section.ref} />;
  }

  /**
   * Starts a press with the primary button on the header, not on one of its buttons.
   *
   * @param event - The pointer down.
   */
  const onPress = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : undefined;
    const isOnButton = target !== undefined && target.closest("button") !== null;
    const isPrimaryPress = event.button === 0 && !isOnButton;
    if (!isPrimaryPress) return;

    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    const head = event.currentTarget instanceof Element ? event.currentTarget : undefined;
    head?.setPointerCapture?.(event.pointerId);
  };

  /**
   * Moves the float with the pointer once the press travelled past the drag threshold.
   *
   * @param event - The pointer move.
   */
  const onDrag = (event: PointerEvent): void => {
    const current = press.current;
    const element = section.current;
    if (current === undefined || element === undefined) return;

    const x = event.clientX - current.x;
    const y = event.clientY - current.y;
    if (!current.moved && Math.hypot(x, y) < DRAG_THRESHOLD) return;

    current.moved = true;
    element.dataset.dragging = "";
    element.style.transform = `translate(${x}px, ${y}px)`;
    syncFrame(ctx);
  };

  /**
   * Ends the press: a drag snaps to the nearest corner; a click on the header does nothing.
   *
   * @param event - The pointer up.
   */
  const onRelease = (event: PointerEvent): void => {
    const current = press.current;
    const element = section.current;
    press.current = undefined;
    if (current === undefined || element === undefined || !current.moved) return;

    dropFloat(ctx, element, ws, { x: event.clientX - current.x, y: event.clientY - current.y });
  };

  return (
    <section
      data-ui="preview"
      data-size={prefs.size}
      data-corner={prefs.corner}
      aria-label="Game preview"
      ref={section.ref}
    >
      <PreviewHead ctx={ctx} ws={ws} prefs={prefs} drag={{ onPress, onDrag, onRelease }} />
      <div data-preview-body ref={body.ref} />
    </section>
  );
}
