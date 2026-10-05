/**
 * @file gameView plugin — gameView's root inside `workspace.gameFrame().overlay()` (device space,
 * game CSS px, scaled with the frame, above the iframe, R4): the Reference mode proxy layer, the
 * picker layer, the hover, selected and tree boxes with the hover label, the safe-area bands, the
 * dynamic island, the home bar and the shutter flash. Foreign DOM with its own Preact root,
 * created once, removed on stop.
 */
import type { VNode } from "preact";
import { render } from "preact";
import type { PageRect, SceneNode } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import type { DeviceSize } from "../../registry/protocol";
import { resolveDevice } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import {
  type DeviceFrame,
  frameOf,
  hasHomeBar,
  hasIsland,
  rectStyle,
  safeBands
} from "../stage/geometry";
import { counterScale, labelPlacement, labelSize, labelText } from "../stage/label";
import type { GameViewCtx } from "../types";
import { PickerLayer } from "./PickerLayer";
import { ProxyLayer } from "./ProxyLayer";
import { useGameView } from "./useGameView";

/**
 * Props of `OverlayRoot`.
 */
export type OverlayRootProps = { readonly ctx: GameViewCtx };

/**
 * The hover box with its counter-scaled label.
 *
 * @param props - The node, its rect, the frame scale and the device size.
 * @param props.node - The hovered node.
 * @param props.rect - Its rect.
 * @param props.scale - The frame scale.
 * @param props.device - The device size.
 * @returns The box and the label.
 */
function HoverBox(props: {
  readonly node: SceneNode;
  readonly rect: PageRect;
  readonly scale: number;
  readonly device: DeviceSize;
}): VNode {
  const { node, rect, scale, device } = props;
  const text = labelText(node);
  const place = labelPlacement(rect, labelSize(text, scale), device);
  return (
    <>
      <div data-box="hover" style={rectStyle(rect)} />
      <span
        data-part="label"
        data-flipped={place.flipped ? "" : undefined}
        style={{
          left: `${place.x}px`,
          top: `${place.y}px`,
          transform: `scale(${counterScale(scale)})`
        }}
      >
        {text}
      </span>
    </>
  );
}

/**
 * The safe-area bands, the dynamic island and the home bar (guides only, F-G2); a home-button
 * phone has neither island nor home bar (round 2b R9).
 *
 * @param props - The device size and the preset.
 * @param props.device - The resolved device.
 * @param props.kind - The preset kind.
 * @param props.frame - The preset's frame.
 * @param props.safeTop - The preset's safeTop.
 * @param props.safeBottom - The preset's safeBottom.
 * @param props.orientation - The orientation.
 * @returns The guides.
 * @example
 * ```tsx
 * <SafeGuides device={size} kind="phone" frame="modern" safeTop={59} safeBottom={34} orientation="portrait" />
 * ```
 */
function SafeGuides(props: {
  readonly device: DeviceSize;
  readonly kind: "phone" | "tablet" | "desktop";
  readonly frame: DeviceFrame;
  readonly safeTop: number;
  readonly safeBottom: number;
  readonly orientation: "portrait" | "landscape";
}): VNode {
  const { device, kind, frame, safeTop, safeBottom, orientation } = props;
  return (
    <div data-part="guides" data-orientation={orientation} aria-hidden="true">
      {safeBands(device).map(band => (
        <div
          key={band.side}
          data-part="band"
          data-side={band.side}
          style={{ "--band": `${band.size}px` }}
        />
      ))}
      {hasIsland(kind, safeTop, frame) && <div data-part="island" />}
      {hasHomeBar(kind, safeBottom, frame) && <div data-part="home" />}
    </div>
  );
}

/**
 * The content of gameView's overlay root.
 *
 * @param props - The gameView domain context.
 * @returns The overlay content.
 */
export function OverlayRoot(props: OverlayRootProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useGameView(state, () => state.scene);
  const workspace = ctx.require(workspacePlugin);
  const active = workspace.active() === "game";
  const choice = workspace.device();
  const device = resolveDevice(choice.preset, choice.orientation);
  const scale = workspace.gameFrame().box()?.scale ?? 1;
  const nodes = state.scene?.nodes;
  const { reference } = state;
  const hoverId = state.picker.on ? state.picker.hover : reference.hover;
  const hover = hoverId === undefined ? undefined : nodes?.get(hoverId);
  const { selected: selectedRef } = state;
  const isSelectedActive = active && selectedRef !== undefined;
  const selected = isSelectedActive ? nodes?.get(refId(selectedRef)) : undefined;
  const tree = state.treeHover === undefined ? undefined : nodes?.get(refId(state.treeHover));
  const guides = active && state.safeArea && choice.preset.kind !== "desktop";

  return (
    <>
      {reference.on && <ProxyLayer ctx={ctx} />}
      {guides && (
        <SafeGuides
          device={device}
          kind={choice.preset.kind}
          frame={frameOf(choice.preset)}
          safeTop={choice.preset.safeTop}
          safeBottom={choice.preset.safeBottom}
          orientation={choice.orientation}
        />
      )}
      {selected?.rect && <div data-box="selected" style={rectStyle(selected.rect)} />}
      {tree?.rect && <div data-box="tree" style={rectStyle(tree.rect)} />}
      {hover?.rect && <HoverBox node={hover} rect={hover.rect} scale={scale} device={device} />}
      {active && state.picker.on && <PickerLayer ctx={ctx} />}
      {active && state.card !== undefined && (
        <div key={state.card.path} data-part="flash" aria-hidden="true" />
      )}
    </>
  );
}

/**
 * gameView's overlay root inside `gameFrame().overlay()`, created on first use with its own
 * Preact root; the remover (render nothing, remove the element) goes into the disposers.
 *
 * @param ctx - Domain context of gameView.
 * @returns The root element, undefined without a DOM.
 */
export function ensureOverlayRoot(ctx: GameViewCtx): HTMLElement | undefined {
  const { state } = ctx;
  if (state.overlayRoot !== undefined) return state.overlayRoot;
  if (globalThis.document === undefined) return undefined;

  const root = document.createElement("div");
  root.dataset.game = "overlay";
  ctx.require(workspacePlugin).gameFrame().overlay().append(root);
  state.overlayRoot = root;
  render(<OverlayRoot ctx={ctx} />, root);
  state.disposers.push(() => {
    render(undefined, root);
    root.remove();
    if (state.overlayRoot === root) state.overlayRoot = undefined;
  });
  return root;
}
