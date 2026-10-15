/**
 * @file overlay plugin — onInit (config checks, the `editor.overlay` command), onStart (host, shadow
 * root, stylesheet, isolation, probes, listeners, the remembered window, the global channel, the
 * start mode) and onStop (removes everything; no emit, no log).
 */
import { render } from "preact";
import { HOST_ATTRIBUTE } from "../registry/protocol";
import { clearChannel, setChannel } from "./channel-global";
import { registerOverlayCommand } from "./command";
import { overlayCtxOf } from "./context";
import { deleteFaces } from "./fonts/register";
import { applyStart } from "./modes";
import { dropCanvas } from "./paint/graph";
import { stopTick, watchSlide, watchVisibility, withAgent } from "./paint/tick";
import { layout, readViewport } from "./place/layout";
import { createProbes, readInsets, watchPlace } from "./place/safe-area";
import { readStored } from "./place/store";
import { overlayCss } from "./styles";
import type { Config, OverlayCtx, OverlayPluginCtx, OverlayStopCtx } from "./types";

/**
 * The events stopped at the host, so overlay input never reaches the game's window and document
 * listeners.
 */
const ISOLATED_EVENTS: readonly string[] = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointercancel",
  "click",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
  "contextmenu",
  "keydown",
  "keyup",
  "input"
];

/** The modes a config may name. */
const MODES: ReadonlySet<unknown> = new Set(["hidden", "pill", "card"]);

/**
 * Stops overlay input at the host.
 *
 * @param event - An input event inside the overlay.
 * @example
 * ```ts
 * host.addEventListener("keydown", isolate);
 * ```
 */
function isolate(event: Event): void {
  event.stopPropagation();
}

/**
 * A two-line config error (spec/11-INVARIANTS Part 3).
 *
 * @param field - The config field.
 * @param value - The value given.
 * @param fix - The second line.
 * @returns The TypeError.
 * @example
 * ```ts
 * configError("dock", "top", 'Use "left" or "right".').message; // '[moku-editor] overlay.dock is "top".\n  Use "left" or "right".'
 * ```
 */
function configError(field: string, value: unknown, fix: string): TypeError {
  return new TypeError(`[moku-editor] overlay.${field} is ${JSON.stringify(value)}.\n  ${fix}`);
}

/**
 * Checks the config: the old keys `corner` and `open` (a JavaScript caller passes them past the
 * type) throw their migration errors; `mode`, `dock` and `remember` must be valid.
 *
 * @param config - The resolved config.
 * @throws {TypeError} For an old key or a bad value.
 */
export function checkConfig(config: Readonly<Config>): void {
  if (Object.hasOwn(config, "corner")) {
    throw new TypeError(
      '[moku-editor] overlay.corner was replaced by overlay.dock ("left" | "right").\n  Fix pluginConfigs.overlay, for example { dock: "left" }.'
    );
  }
  if (Object.hasOwn(config, "open")) {
    throw new TypeError(
      '[moku-editor] overlay.open was replaced by overlay.mode ("hidden" | "pill" | "card").\n  Fix pluginConfigs.overlay, for example { mode: "card" }.'
    );
  }
  if (!MODES.has(config.mode)) {
    throw configError("mode", config.mode, 'Use "hidden", "pill" or "card".');
  }
  if (config.dock !== "left" && config.dock !== "right") {
    throw configError("dock", config.dock, 'Use "left" or "right".');
  }
  if (typeof config.remember !== "boolean") {
    throw configError("remember", config.remember, "Use true or false.");
  }
}

/**
 * onInit: checks the config, then adds `editor.overlay` to the registry.
 *
 * @param ctx - Plugin context of the overlay.
 */
export function initOverlay(ctx: OverlayPluginCtx): void {
  checkConfig(ctx.config);
  registerOverlayCommand(overlayCtxOf(ctx));
}

/**
 * The document of the page, when there is one.
 *
 * @returns The document, or undefined outside a browser.
 * @example
 * ```ts
 * pageDocument(); // globalThis.document in a browser
 * ```
 */
function pageDocument(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

/**
 * onStart: `startOverlayWith(overlayCtxOf(ctx), ctx.has("bridge"), document)`.
 *
 * @param ctx - Plugin context of the overlay.
 */
export function startOverlay(ctx: OverlayPluginCtx): void {
  startOverlayWith(overlayCtxOf(ctx), ctx.has("bridge"), pageDocument());
}

/**
 * The element the host goes into: the `mount` selector's match, else body (warns when the selector
 * matches nothing).
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
 * Puts the stylesheet into the shadow root: adopted when `CSSStyleSheet.replaceSync` exists, else a
 * `<style>` element.
 *
 * @param doc - The document.
 * @param root - The shadow root.
 */
function adoptSheet(doc: Document, root: ShadowRoot): void {
  if (typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(overlayCss);
    root.adoptedStyleSheets = [sheet];
    return;
  }
  const style = doc.createElement("style");
  style.textContent = overlayCss;
  root.append(style);
}

/**
 * Creates the hidden host with its open shadow root, the sheet, the safe-area probes, the element
 * Preact renders into and the isolation listener, and appends it.
 *
 * @param octx - Domain context.
 * @param doc - The document.
 */
function mountHost(octx: OverlayCtx, doc: Document): void {
  const { state } = octx;
  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  host.hidden = true;
  const root = host.attachShadow({ mode: "open" });
  adoptSheet(doc, root);
  state.probes = createProbes(doc, root);
  const container = doc.createElement("div");
  container.dataset.root = "";
  root.append(container);
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, isolate);
  state.host = host;
  state.root = root;
  state.container = container;
  state.isolate = isolate;
  layout(state);
  parentOf(octx, doc).append(host);
}

/**
 * Starts the overlay on a document: the host, the listeners and observers, the remembered window,
 * the global channel and the start mode. Without a document it warns `overlay:no-dom` and does
 * nothing else (the api still answers).
 *
 * @param octx - Domain context.
 * @param hasBridge - Whether the bridge is composed (`ctx.has("bridge")`).
 * @param doc - The document, or undefined outside a browser.
 */
export function startOverlayWith(
  octx: OverlayCtx,
  hasBridge: boolean,
  doc: Document | undefined
): void {
  const { state } = octx;
  state.started = true;
  state.hasBridge = hasBridge;
  if (doc === undefined) {
    octx.log.warn("overlay:no-dom");
    return;
  }

  mountHost(octx, doc);
  const root = state.root;
  if (root !== undefined) watchSlide(state, root);
  watchPlace(octx, doc.defaultView ?? undefined);
  watchVisibility(octx, doc);
  withAgent(octx, () => {
    readViewport(state);
    readInsets(octx);
  });
  const stored = readStored(octx);
  setChannel(octx);
  applyStart(octx, stored);
}

/**
 * onStop: clears the tick, unrenders, removes every listener and observer, the isolation listener
 * and the host, deletes the registered faces and the global channel when it is ours. No emit, no
 * log (teardown context). The store keeps the last place, mode and tab.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopOverlay(ctx: OverlayStopCtx): void {
  const { state } = ctx;
  stopTick(state);
  if (state.container !== undefined) render(undefined, state.container);
  dropCanvas(state);
  for (const off of state.off.splice(0)) off();
  const { host, isolate: listener } = state;
  if (host !== undefined && listener !== undefined) {
    for (const type of ISOLATED_EVENTS) host.removeEventListener(type, listener);
  }
  deleteFaces(state);
  host?.remove();
  clearChannel(state);
  state.host = undefined;
  state.root = undefined;
  state.container = undefined;
  state.probes = [];
  state.isolate = undefined;
  state.drag = undefined;
  state.started = false;
}
