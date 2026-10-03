/**
 * @file workspace plugin — B3, the pinned game preview: a float in a corner of the workspace's
 * preview zone (12 px margin plus the zone insets), header "Game" (M/L add the device), S/M/L,
 * "Open in Game", "Hide"; a body click cycles S → M → L → S; a pointer drag (≥ 4 px) moves it and
 * snaps to the nearest corner on release; Alt+arrows on the header move it a corner. The game
 * frame is docked over the body by geometry (the iframe never moves; it takes no pointer here).
 */
import type { VNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { showWorkspace } from "../actions";
import { presetOf, resolveDevice } from "../devices";
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
import { Icon } from "./icons";
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
 * The size after a body click.
 */
const NEXT_SIZE: Readonly<Record<PreviewSize, PreviewSize>> = { S: "M", M: "L", L: "S" };

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
 * A pointer press on the float.
 */
type Press = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly onBody: boolean;
  moved: boolean;
};

/**
 * The zone rect of a workspace: its registered zone element, else its host.
 *
 * @param ctx - Domain context of workspace.
 * @param ws - The workspace.
 * @returns The zone rect and its insets.
 * @example
 * ```ts
 * zoneOf(ctx, "flow").rect.width;
 * ```
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
 * Places the float in its corner and re-docks the frame over the body.
 *
 * @param ctx - Domain context of workspace.
 * @param section - The float element.
 * @param ws - The workspace.
 * @param prefs - Its preview prefs.
 * @example
 * ```ts
 * placeFloat(ctx, section, "flow", ctx.state.previews.flow);
 * ```
 */
function placeFloat(
  ctx: WorkspaceCtx,
  section: HTMLElement,
  ws: PreviewWorkspace,
  prefs: PreviewPrefs
): void {
  const { rect, insets } = zoneOf(ctx, ws);
  const float = floatRect(rect, insets, prefs.corner, PREVIEW_SIZES[prefs.size]);
  section.style.left = `${float.left}px`;
  section.style.top = `${float.top}px`;
  section.style.width = `${float.width}px`;
  section.style.height = `${float.height}px`;
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
 * @example
 * ```ts
 * dropFloat(ctx, section, "flow", { x: -800, y: -600 });
 * ```
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
 * The preview header: title, device, S/M/L, open in Game, hide.
 *
 * @param props - Context, workspace and prefs.
 * @param props.ctx - Domain context of workspace.
 * @param props.ws - The workspace.
 * @param props.prefs - Its preview prefs.
 * @returns The header.
 * @example
 * ```tsx
 * <PreviewHead ctx={ctx} ws="flow" prefs={prefs} />
 * ```
 */
function PreviewHead(props: {
  readonly ctx: WorkspaceCtx;
  readonly ws: PreviewWorkspace;
  readonly prefs: PreviewPrefs;
}): VNode {
  const { ctx, ws, prefs } = props;
  const preset = presetOf(ctx.state.device.preset);
  const size = resolveDevice(preset, ctx.state.device.orientation);

  return (
    <header
      data-preview-head
      role="toolbar"
      tabIndex={0}
      aria-label="Game preview, Alt and an arrow key move it"
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
        title="Open in Game (⌘2)"
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
 * @example
 * ```tsx
 * <Preview ctx={ctx} />
 * ```
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
    state.frame.previewBody = shown ? body.current : undefined;
    if (element !== undefined && ws !== undefined && prefs !== undefined && shown) {
      placeFloat(ctx, element, ws, prefs);
    }
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
  return (
    <section
      data-ui="preview"
      data-size={prefs.size}
      data-corner={prefs.corner}
      aria-label="Game preview"
      ref={section.ref}
      onPointerDown={event => {
        if (
          event.button !== 0 ||
          (event.target instanceof Element && event.target.closest("button"))
        ) {
          return;
        }
        const onBody =
          event.target instanceof Element && event.target.closest("[data-preview-body]") !== null;
        press.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          onBody,
          moved: false
        };
        section.current?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => {
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
      }}
      onPointerUp={event => {
        const current = press.current;
        const element = section.current;
        press.current = undefined;
        if (current === undefined || element === undefined) return;
        if (current.moved) {
          dropFloat(ctx, element, ws, {
            x: event.clientX - current.x,
            y: event.clientY - current.y
          });
        } else if (current.onBody) {
          patchPreview(ctx, ws, { size: NEXT_SIZE[prefs.size] });
        }
      }}
    >
      <PreviewHead ctx={ctx} ws={ws} prefs={prefs} />
      <div data-preview-body ref={body.ref} title="Click to change the size, drag to move" />
    </section>
  );
}
