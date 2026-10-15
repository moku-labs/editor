/**
 * @file overlay plugin — reads what the view needs (perf, the recorder, the registry, the window
 * facts through the count visitor), turns it into the view model (`viewOf`, pure) and renders the
 * Preact tree into the shadow root's container.
 */
import { h, render } from "preact";
import type { PerfSecond, PerfSpikeRecord, PerfStatus } from "../../perf/protocol";
import type { LogFileInfo, LogMark, RecorderStatus } from "../../recorder/types";
import type { BuildInfo } from "../../registry/protocol";
import { actionsOf } from "../actions";
import { counterCells, framesNote, moreParts, navView, systemsText } from "../model/frames";
import { gameView, overlayCommands, tabsOf } from "../model/game";
import { engineLine, headerView, pillLabel } from "../model/header";
import { linkTabView } from "../model/link";
import { recordView } from "../model/record";
import { recordTabView } from "../model/record-tab";
import type { FramesView, OverlayView, ToastView } from "../model/types";
import { emitChanged } from "../modes";
import { windowSize } from "../place/dock";
import { writeStored } from "../place/store";
import type { OverlayCommand, OverlayCtx, OverlayState } from "../types";
import { Overlay } from "../view/Overlay";

/**
 * What one render reads from the other plugins.
 */
export type ViewInputs = {
  readonly status: PerfStatus;
  readonly second: PerfSecond;
  readonly commands: readonly OverlayCommand[];
  readonly build: BuildInfo;
  readonly game: string;
  readonly recStatus: RecorderStatus;
  readonly marks: readonly LogMark[];
  readonly files: readonly LogFileInfo[];
  readonly record: PerfSpikeRecord | undefined;
};

/**
 * The open record: perf's (kept as the copy), or the copy after its spike left the window. Closes
 * the record when neither exists.
 *
 * @param octx - Domain context.
 * @returns The record, or undefined.
 */
function openRecord(octx: OverlayCtx): PerfSpikeRecord | undefined {
  const { state } = octx;
  const frame = state.record;
  if (frame === undefined) return undefined;
  const fresh = octx.perf.spike(frame);
  if (fresh !== undefined) {
    state.recordCopy = fresh;
    return fresh;
  }
  if (state.recordCopy?.frame === frame) return state.recordCopy;
  state.record = undefined;
  return undefined;
}

/**
 * Reads the inputs of one render. The window is read only through the count visitor.
 *
 * @param octx - Domain context.
 * @returns The inputs.
 */
export function readInputs(octx: OverlayCtx): ViewInputs {
  const { state, registry, recorder } = octx;
  octx.perf.readWindow(octx.visitors.count);
  const manifest = registry.manifest();
  const card = state.mode === "card";
  const lookup = { manifest: () => manifest, command: (id: string) => registry.command(id) };
  return {
    status: octx.perf.status(),
    second: octx.perf.second(),
    commands: overlayCommands(lookup, card && state.tab === "game"),
    build: registry.build(),
    game: manifest.game,
    recStatus: recorder.status(),
    marks: card && state.tab === "record" ? recorder.marks() : [],
    files: card && state.tab === "record" ? recorder.files() : [],
    record: card && state.tab === "frames" ? openRecord(octx) : undefined
  };
}

/**
 * The Frames tab's view.
 *
 * @param state - Overlay state.
 * @param inputs - The inputs.
 * @param compact - The compact card.
 * @returns The view.
 */
function framesViewOf(state: OverlayState, inputs: ViewInputs, compact: boolean): FramesView {
  const { status, second, record } = inputs;
  const facts = state.facts;
  const gpuTimer = status.state === "on" ? status.gpuTimer : facts.gpuTimer;
  let kind: FramesView["state"] = status.state === "on" ? "graph" : status.state;
  if (record !== undefined) kind = "record";
  return {
    state: kind,
    note: framesNote(status),
    gpuTimer,
    compact,
    nav: navView(facts.total, facts.ordinal),
    offline: state.hasBridge && state.link?.link?.mode === "none",
    counters: counterCells(second, facts.gpuAvg, compact, gpuTimer),
    more: state.more,
    systems: systemsText(second.sample),
    parts: moreParts(second, compact),
    record:
      record === undefined
        ? undefined
        : recordView(record, inputs.recStatus, facts.ordinal, facts.total)
  };
}

/**
 * Everything the overlay draws, from its state and the inputs at `now` (pure).
 *
 * @param state - Overlay state.
 * @param inputs - What the render read.
 * @param now - Epoch ms (the toast's expiry, "seen N s ago").
 * @returns The view.
 */
export function viewOf(state: OverlayState, inputs: ViewInputs, now: number): OverlayView {
  const { compact } = windowSize("card", state.viewport);
  const header = headerView({
    second: inputs.second,
    status: inputs.status,
    payload: state.link,
    hasBridge: state.hasBridge,
    engine: inputs.build.engine,
    recording: inputs.recStatus.state === "recording"
  });
  const toast: ToastView | undefined =
    state.toast !== undefined && state.toast.until > now
      ? { text: state.toast.text, tone: state.toast.tone }
      : undefined;
  const card = state.mode === "card";
  const tab = state.tab;
  return {
    mode: state.mode,
    dock: state.place.dock,
    compact,
    header,
    pillLabel: pillLabel(header),
    tabs: tabsOf(inputs.commands.length > 0),
    tab,
    engine: engineLine(inputs.build, header.stale),
    frames: card && tab === "frames" ? framesViewOf(state, inputs, compact) : undefined,
    game:
      card && tab === "game"
        ? gameView(inputs.game, inputs.commands, state.busy, toast)
        : undefined,
    record:
      card && tab === "record"
        ? recordTabView({
            status: inputs.recStatus,
            marks: inputs.marks,
            files: inputs.files,
            payload: state.link,
            hasBridge: state.hasBridge,
            draft: state.markDraft,
            toast
          })
        : undefined,
    link:
      card && tab === "link"
        ? linkTabView({
            payload: state.link,
            hasBridge: state.hasBridge,
            rec: state.rec,
            stale: header.stale,
            draft: state.addressDraft,
            error: state.addressError,
            build: inputs.build,
            now
          })
        : undefined
  };
}

/**
 * Renders the overlay into the shadow root's container. When the game's overlay commands vanished
 * while the Game tab shows, the tab falls back to Frames (stored and emitted).
 *
 * @param octx - Domain context.
 */
export function renderOverlay(octx: OverlayCtx): void {
  const { state } = octx;
  const container = state.container;
  if (container === undefined) return;
  const inputs = readInputs(octx);
  if (state.tab === "game" && inputs.commands.length === 0) {
    state.tab = "frames";
    writeStored(octx);
    emitChanged(octx);
  }
  const view = viewOf(state, inputs, Date.now());
  render(h(Overlay, { view, actions: actionsOf(octx) }), container);
}
