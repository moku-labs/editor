/**
 * @file overlay plugin — what the person's input does: the header keys, the tabs, prev / next and
 * the graph tap, the Game tab's presses, the Record tab's keys and the Link tab's Connect. Every
 * action renders at once through `paintNow` (inside the agent bracket). The actions object the view
 * gets is made once per plugin state, so the canvas ref keeps its identity across renders.
 */
import type { Json } from "../registry/protocol";
import { bareMessage, errorCode, toWireError } from "../registry/protocol";
import { clockText } from "./model/format";
import { overlayCommands, READ_ONLY_TEXT, reasonText } from "./model/game";
import { ADDRESS_HINT, checkAddress } from "./model/link";
import { closeOverlay, openOverlay, setMode, setTab } from "./modes";
import { mountCanvas } from "./paint/graph";
import { paintNow } from "./paint/tick";
import { windowSize } from "./place/dock";
import type { KeyLike, PointerLike } from "./place/drag";
import { gripDown, gripKey, gripMove, gripUp } from "./place/drag";
import type { OverlayCommand, OverlayCtx, OverlayState, OverlayTab } from "./types";
import { TOAST_MS } from "./types";

/** Card width the graph well leaves to the canvas: body padding, nav column, gap and border. */
const WELL_INSET_W = 70;

/** Graph row height on the card and on the compact card; the canvas is 2 px less (the border). */
const ROW_H = 110;
const ROW_H_COMPACT = 88;

/**
 * The callbacks the view calls.
 */
export type OverlayActions = {
  readonly openCard: () => void;
  readonly collapse: () => void;
  readonly hide: () => void;
  readonly tab: (tab: OverlayTab) => void;
  readonly step: (dir: 1 | -1) => void;
  readonly tapGraph: (event: {
    readonly clientX: number;
    readonly clientY: number;
    readonly currentTarget: EventTarget | null;
  }) => void;
  readonly back: () => void;
  readonly more: () => void;
  readonly press: (id: string) => void;
  readonly record: (action: "start" | "stop") => void;
  readonly markDraft: (text: string) => void;
  readonly mark: () => void;
  readonly share: (name: string) => void;
  readonly remove: (name: string) => void;
  readonly addressDraft: (text: string) => void;
  readonly connect: () => void;
  readonly canvas: (element: HTMLCanvasElement | null) => void;
  readonly gripDown: (event: PointerLike) => void;
  readonly gripMove: (event: PointerLike) => void;
  readonly gripUp: (event: PointerLike) => void;
  readonly gripKey: (event: KeyLike) => void;
};

/**
 * Does nothing: the actions' promises never reject (each catches its own failure).
 */
function settled(): void {}

/** The actions of each plugin state. */
const actionsByState = new WeakMap<OverlayState, OverlayActions>();

/**
 * Shows a toast line on the Game or Record tab for `TOAST_MS`; the next replaces it.
 *
 * @param octx - Domain context.
 * @param text - The line.
 * @param tone - "info" (cyan) or "error" (red).
 */
export function showToast(octx: OverlayCtx, text: string, tone: "info" | "error"): void {
  octx.state.toast = { text, tone, until: Date.now() + TOAST_MS };
}

/**
 * The first line of an error's message without the `[moku-editor]` prefix.
 *
 * @param error - Anything thrown.
 * @returns The text.
 * @example
 * ```ts
 * errorText(new Error("[moku-editor] recorder.start needs a monitor.\n  Use a debug build.")); // "recorder.start needs a monitor."
 * ```
 */
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return bareMessage(message).split("\n")[0] ?? "";
}

/**
 * Presses a Game tab command: a toggle runs `{ on: !value }`, a button `{}`, through
 * `channel.run(id, input, "overlay")` (the recorder's `registry:command` hook writes the one
 * `command` line); a success adds the recorder's auto mark and toasts; a -32009 refusal toasts its
 * reason (`read_only`: a --debug=full build, `dev_only`: a dev or debug build); any other failure
 * toasts and warns. Ignored while busy or for a refused command.
 *
 * @param octx - Domain context.
 * @param id - The command id.
 * @returns Settles when the run settled; never rejects.
 */
export async function pressCommand(octx: OverlayCtx, id: string): Promise<void> {
  // Guard: a press in flight, or an unknown or refused command, does nothing.
  const { state } = octx;
  if (state.busy.has(id)) return;
  const command = overlayCommands(octx.registry).find(each => each.id === id);
  if (command === undefined || !command.allowed) return;

  // Gather: a toggle runs the opposite of its value; the mark names the value it switches to.
  const toggle = command.kind === "toggle";
  const on = command.value !== true;
  const input: Json = toggle ? { on } : {};
  const switchedTo = on ? "on" : "off";
  const label = toggle ? `${command.title} ${switchedTo}` : command.title;
  state.busy.add(id);
  paintNow(octx);
  try {
    // Run: through the channel as the overlay (the recorder's hook writes the one command line).
    await octx.channel.run(id, input, "overlay");
    // Report: the recorder's auto mark, then the toast.
    octx.recorder.command(id, input, label);
    const status = octx.recorder.status();
    const logged =
      status.state === "recording" ? ` Logged as a mark at ${clockText(status.sinceMs)}.` : "";
    showToast(octx, `${label}.${logged}`, "info");
  } catch (error) {
    toastPressFailure(octx, command, error);
  } finally {
    // Cleanup: the row can be pressed again.
    state.busy.delete(id);
    paintNow(octx);
  }
}

/**
 * Toasts a press that failed: a -32009 refusal names its reason (`dev_only`: a dev or debug build,
 * else a --debug=full build); any other failure shows its message and warns
 * `overlay:command-failed`.
 *
 * @param octx - Domain context.
 * @param command - The command pressed.
 * @param error - What the run rejected with.
 */
function toastPressFailure(octx: OverlayCtx, command: OverlayCommand, error: unknown): void {
  const wire = toWireError(error);
  if (wire.code === errorCode.readOnly) {
    const why = wire.data?.reason === "dev_only" ? reasonText("dev-only") : READ_ONLY_TEXT;
    showToast(octx, `${command.title} ${why}.`, "error");
    return;
  }
  showToast(octx, `${command.title} failed: ${errorText(error)}`, "error");
  octx.log.warn("overlay:command-failed", {
    id: command.id,
    code: wire.code,
    message: wire.message
  });
}

/**
 * Starts or stops the recorder, with a toast either way.
 *
 * @param octx - Domain context.
 * @param action - "start" or "stop".
 * @returns Settles when the recorder answered; never rejects.
 */
export async function switchRecording(octx: OverlayCtx, action: "start" | "stop"): Promise<void> {
  try {
    if (action === "start") {
      octx.recorder.start();
      showToast(octx, "Recording started.", "info");
    } else {
      await octx.recorder.stop();
      showToast(octx, "Recording stopped, log kept on the phone.", "info");
    }
  } catch (error) {
    showToast(octx, errorText(error), "error");
  }
  paintNow(octx);
}

/**
 * Adds a mark with the field's label ("mark" when empty) and clears the field.
 *
 * @param octx - Domain context.
 */
export function addMark(octx: OverlayCtx): void {
  const { state } = octx;
  const label = state.markDraft.trim() || "mark";
  const added = octx.recorder.mark(label);
  state.markDraft = "";
  if (added) {
    showToast(octx, `Mark added at ${clockText(octx.recorder.status().sinceMs)}.`, "info");
  } else {
    showToast(octx, "Not recording: start a log to add marks.", "error");
  }
  paintNow(octx);
}

/**
 * Shares a saved log (the native share sheet, or a download), with a toast of the outcome.
 *
 * @param octx - Domain context.
 * @param name - The log's name.
 * @returns Settles when the share settled; never rejects.
 */
export async function shareLog(octx: OverlayCtx, name: string): Promise<void> {
  try {
    const result = await octx.recorder.share(name);
    if (result === "shared") showToast(octx, `Share sheet opened for ${name}.`, "info");
    else if (result === "cancelled") showToast(octx, "Share cancelled.", "info");
    else showToast(octx, `Downloaded ${name}.`, "info");
  } catch (error) {
    showToast(octx, errorText(error), "error");
  }
  paintNow(octx);
}

/**
 * Deletes a saved log, with a toast.
 *
 * @param octx - Domain context.
 * @param name - The log's name.
 * @returns Settles when the delete settled; never rejects.
 */
export async function deleteLog(octx: OverlayCtx, name: string): Promise<void> {
  try {
    await octx.recorder.remove(name);
    showToast(octx, `Deleted ${name}.`, "info");
  } catch (error) {
    showToast(octx, errorText(error), "error");
  }
  paintNow(octx);
}

/**
 * Connect / Pair: checks the address field (or the bridge's address when untouched); a bad value
 * shows the hint and emits nothing, a good one emits the intent `overlay:connect { address }`.
 * Nothing without a bridge.
 *
 * @param octx - Domain context.
 */
export function connectLink(octx: OverlayCtx): void {
  const { state } = octx;
  if (!state.hasBridge) return;
  const address = checkAddress(state.addressDraft ?? state.link?.link?.address ?? "");
  if (address === undefined) {
    state.addressError = ADDRESS_HINT;
  } else {
    state.addressError = undefined;
    octx.emit("overlay:connect", { address });
  }
  paintNow(octx);
}

/**
 * Steps the selection (or the open record) to the previous / next spike.
 *
 * @param octx - Domain context.
 * @param dir - -1 or 1.
 */
export function stepSpikes(octx: OverlayCtx, dir: 1 | -1): void {
  octx.state.probe.dir = dir;
  octx.perf.readWindow(octx.visitors.nav);
  paintNow(octx);
}

/**
 * A tap on the graph at CSS px inside the canvas: a flag or a spike bar opens its record, else the
 * frame under the tap is selected.
 *
 * @param octx - Domain context.
 * @param x - CSS px from the canvas's left.
 * @param y - CSS px from its top.
 */
export function tapGraph(octx: OverlayCtx, x: number, y: number): void {
  octx.state.probe.x = x;
  octx.state.probe.y = y;
  octx.perf.readWindow(octx.visitors.hit);
  paintNow(octx);
}

/**
 * The design size of the graph canvas for the card now (until the ResizeObserver measures it).
 *
 * @param state - Overlay state.
 * @returns CSS px.
 */
function canvasSize(state: OverlayState): { readonly w: number; readonly h: number } {
  const size = windowSize("card", state.viewport);
  return { w: Math.max(1, size.w - WELL_INSET_W), h: (size.compact ? ROW_H_COMPACT : ROW_H) - 2 };
}

/**
 * True for an event target that can report its box (an element).
 *
 * @param target - The event's current target.
 * @returns Whether `getBoundingClientRect` can be called on it.
 * @example
 * ```ts
 * hasBoundingBox(null); // false
 * ```
 */
function hasBoundingBox(target: EventTarget | null): target is EventTarget & {
  getBoundingClientRect(): { readonly left: number; readonly top: number };
} {
  return (
    target !== null &&
    "getBoundingClientRect" in target &&
    typeof target.getBoundingClientRect === "function"
  );
}

/**
 * The point of a pointer event inside its target, CSS px.
 *
 * @param event - The event.
 * @param event.clientX - Viewport x.
 * @param event.clientY - Viewport y.
 * @param event.currentTarget - The canvas.
 * @returns x and y from the target's top left.
 */
function pointIn(event: {
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: EventTarget | null;
}): { readonly x: number; readonly y: number } {
  const target = event.currentTarget;
  const box = hasBoundingBox(target) ? target.getBoundingClientRect() : { left: 0, top: 0 };
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/**
 * The actions of a domain context, made once per plugin state.
 *
 * @param octx - Domain context.
 * @returns The callbacks of the view.
 */
export function actionsOf(octx: OverlayCtx): OverlayActions {
  const known = actionsByState.get(octx.state);
  if (known !== undefined) return known;

  const { state } = octx;
  const actions: OverlayActions = {
    openCard: () => {
      openOverlay(octx);
    },
    collapse: () => {
      setMode(octx, "pill");
    },
    hide: () => {
      closeOverlay(octx);
    },
    tab: tab => {
      setTab(octx, tab);
    },
    step: dir => {
      stepSpikes(octx, dir);
    },
    tapGraph: event => {
      const { x, y } = pointIn(event);
      tapGraph(octx, x, y);
    },
    back: () => {
      state.record = undefined;
      paintNow(octx);
    },
    more: () => {
      state.more = !state.more;
      paintNow(octx);
    },
    press: id => {
      pressCommand(octx, id).catch(settled);
    },
    record: action => {
      switchRecording(octx, action).catch(settled);
    },
    markDraft: text => {
      state.markDraft = text;
      paintNow(octx);
    },
    mark: () => {
      addMark(octx);
    },
    share: name => {
      shareLog(octx, name).catch(settled);
    },
    remove: name => {
      deleteLog(octx, name).catch(settled);
    },
    addressDraft: text => {
      state.addressDraft = text;
      state.addressError = undefined;
      paintNow(octx);
    },
    connect: () => {
      connectLink(octx);
    },
    canvas: element => {
      mountCanvas(octx, element, canvasSize(state));
    },
    gripDown: event => {
      gripDown(octx, event);
    },
    gripMove: event => {
      gripMove(octx, event);
    },
    gripUp: event => {
      gripUp(octx, event);
    },
    gripKey: event => {
      gripKey(octx, event);
    }
  };
  actionsByState.set(state, actions);
  return actions;
}
