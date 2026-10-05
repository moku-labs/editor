/**
 * @file overlay plugin — onStart (host, shadow root, stylesheet, isolation listener, hidden card;
 * opens when config.open) and onStop (removes everything).
 */
import { render } from "preact";
import { HOST_ATTRIBUTE } from "../registry/protocol";
import { openOverlay } from "./api";
import { overlayCtxOf } from "./context";
import { paint } from "./paint";
import { overlayCss } from "./styles";
import type { OverlayCtx, OverlayPluginCtx, OverlayState } from "./types";

/**
 * The events stopped at the host, so overlay input never reaches the game's window/document
 * listeners.
 */
const ISOLATED_EVENTS: readonly string[] = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "click",
  "wheel",
  "touchstart",
  "touchend",
  "keydown",
  "keyup"
];

/**
 * Stops overlay input at the host, so it never reaches the game's listeners.
 *
 * @param event - A pointer, wheel, touch, click or key event inside the card.
 * @example
 * ```ts
 * host.addEventListener("keydown", isolate);
 * ```
 */
function isolate(event: Event): void {
  event.stopPropagation();
}

/**
 * onStart: `mountOverlay(overlayCtxOf(ctx), ctx.has("bridge"))`, then opens when `open()` was
 * called before start or `config.open` is set.
 *
 * @param ctx - Plugin context of the overlay.
 */
export function startOverlay(ctx: OverlayPluginCtx): void {
  const octx = overlayCtxOf(ctx);
  mountOverlay(octx, ctx.has("bridge"));
  if (octx.state.open || octx.config.open) openOverlay(octx);
}

/**
 * The element the host goes into: the `mount` selector's match, else body (warns when the
 * selector matches nothing).
 *
 * @param octx - Domain context.
 * @param doc - The document.
 * @returns The parent element.
 */
function parentOf(octx: OverlayCtx, doc: Document): Element {
  const { mount } = octx.config;
  if (mount === undefined) return doc.body;

  const parent = doc.querySelector(mount);
  if (parent !== null) return parent;
  octx.log.warn("overlay:mount-missing", { mount });
  return doc.body;
}

/**
 * Puts the stylesheet into the shadow root through adoptedStyleSheets. Without
 * `CSSStyleSheet.replaceSync`, paint adds a `<style>` element instead.
 *
 * @param root - The shadow root.
 * @example
 * ```ts
 * adoptSheet(host.attachShadow({ mode: "open" }));
 * ```
 */
function adoptSheet(root: ShadowRoot): void {
  if (typeof CSSStyleSheet !== "function" || !("replaceSync" in CSSStyleSheet.prototype)) return;

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(overlayCss);
  root.adoptedStyleSheets = [sheet];
}

/**
 * The document to mount into: the given one, else the global one when it exists.
 *
 * @param doc - The document passed by the caller, if any.
 * @returns The document, or undefined outside a browser.
 * @example
 * ```ts
 * documentOf(undefined); // globalThis.document in a browser
 * ```
 */
function documentOf(doc: Document | undefined): Document | undefined {
  if (doc !== undefined) return doc;
  return typeof document === "undefined" ? undefined : document;
}

/**
 * Creates the host in the mount element (or body), the shadow root and the sheet; attaches the
 * isolation listener and paints the card hidden. No DOM → warn, nothing mounted.
 *
 * @param octx - Domain context.
 * @param hasBridge - Whether the bridge is composed (link dot).
 * @param doc - The document; globalThis.document by default.
 */
export function mountOverlay(octx: OverlayCtx, hasBridge: boolean, doc?: Document): void {
  const { state } = octx;
  state.hasBridge = hasBridge;
  const target = documentOf(doc);
  if (target === undefined) {
    octx.log.warn("overlay:no-dom");
    return;
  }

  const host = target.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  host.dataset.corner = octx.config.corner;
  host.hidden = true;
  const root = host.attachShadow({ mode: "open" });
  adoptSheet(root);

  for (const type of ISOLATED_EVENTS) host.addEventListener(type, isolate);
  parentOf(octx, target).append(host);

  state.host = host;
  state.root = root;
  state.isolate = isolate;
  paint(octx);
}

/**
 * onStop: clears the interval, stops the watch, unrenders, removes the listener and the host.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function unmountOverlay(ctx: { readonly state: OverlayState }): void {
  const { state } = ctx;
  clearInterval(state.paintTimer);
  state.paintTimer = undefined;
  state.stopRender?.();
  state.stopRender = undefined;
  if (state.root !== undefined) render(undefined, state.root);
  const { host, isolate } = state;
  if (host !== undefined && isolate !== undefined) {
    for (const type of ISOLATED_EVENTS) host.removeEventListener(type, isolate);
  }
  host?.remove();
  state.host = undefined;
  state.root = undefined;
  state.isolate = undefined;
}
