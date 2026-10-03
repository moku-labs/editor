/**
 * @file panels plugin — the controller of one mounted panel (11-panels "Mount behaviour"): the
 * section, one link watch per present source, renders coalesced to one per frame, the generic F5
 * placeholders, stale marking, the manifest recheck, teardown, and `runFromPanel` (every run made
 * from a panel emits the global `workspace:ran`, R4). Nothing here polls: the only timers are the
 * 400 ms and 5 s steps of the waiting placeholder.
 */
import type { Log } from "@moku-labs/common/browser";
import { h, render } from "preact";
import type { LinkApi } from "../link/types";
import type { EditorChannel, Json, LinkStatus, Manifest, RunResult } from "../registry/protocol";
import { toWireError } from "../registry/protocol";
import type { RanEvent, WorkspaceApi } from "../workspace/types";
import { PanelBoundary, Placeholder, type PlaceholderState } from "./PanelBoundary";
import type { MountedPanel, PanelRunOrigin, PanelSpec, PanelsCtx, PanelTools } from "./types";

/**
 * The waiting placeholder shows its spinner line after this long.
 */
export const SPINNER_AFTER_MS = 400;

/**
 * The waiting placeholder names the silent sources after this long.
 */
export const ESCALATE_AFTER_MS = 5000;

/**
 * The generic "no game" line of a panel (F5, R4).
 */
export const NO_GAME_TEXT = "No game connected · this panel fills in when a game connects.";

/**
 * Link kinds in which a panel without values says "no game".
 */
const NO_GAME_KINDS: ReadonlySet<LinkStatus["kind"]> = new Set(["empty", "connecting", "lost"]);

/**
 * What a mounted panel needs from the host.
 */
export type MountDeps = {
  readonly link: LinkApi;
  readonly workspace: WorkspaceApi;
  readonly log: Log.LogApi;
  readonly emit: PanelsCtx["emit"];
  /** The link status the panel starts with. */
  readonly status: LinkStatus;
  /** Runs a render on the next frame (scheduleFrame; tests pass a manual queue). */
  readonly schedule: (render: () => void) => void;
};

/**
 * What runFromPanel needs.
 */
export type RunDeps = Pick<MountDeps, "link" | "emit">;

/**
 * The tools of an erased view.
 */
type ErasedTools = PanelTools<Readonly<Record<string, string>>>;

/**
 * One declared source, normalised.
 */
type Entry = { readonly key: string; readonly id: string; readonly input: Json | undefined };

/**
 * Where the waiting placeholder stands.
 */
type Phase = "quiet" | "spinner" | "escalated";

/**
 * The render state of a section.
 */
type SectionState = PlaceholderState | "ready";

/**
 * The private side of one mounted panel.
 */
type Controller = {
  readonly panel: MountedPanel;
  readonly deps: MountDeps;
  readonly entries: readonly Entry[];
  readonly run: ErasedTools["run"];
  readonly channel: EditorChannel;
  status: LinkStatus;
  failed: boolean;
  unmounted: boolean;
  phase: Phase;
  timers: ReturnType<typeof setTimeout>[];
};

/**
 * Runs a render on the next animation frame; on the next microtask where
 * `requestAnimationFrame` is missing.
 *
 * @param draw - The render.
 */
export function scheduleFrame(draw: () => void): void {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => draw());
    return;
  }
  queueMicrotask(draw);
}

/**
 * Runs a command through link and reports it as the global `workspace:ran` (R4, R9): `ok: true`
 * with the result, or `ok: false` with the WireError, then resolves or rejects like `link.run`.
 *
 * @param deps - link and emit.
 * @param id - Command id.
 * @param input - Command input, undefined for none.
 * @param origin - Where the run started.
 * @returns The RunResult of link.run.
 */
export async function runFromPanel(
  deps: RunDeps,
  id: string,
  input: Json | undefined,
  origin: PanelRunOrigin
): Promise<RunResult> {
  try {
    const result = await deps.link.run(id, input);
    const ran: RanEvent = { id, input, origin, at: Date.now(), ok: true, result };
    deps.emit("workspace:ran", ran);
    return result;
  } catch (error) {
    const ran: RanEvent = {
      id,
      input,
      origin,
      at: Date.now(),
      ok: false,
      error: toWireError(error)
    };
    deps.emit("workspace:ran", ran);
    throw error;
  }
}

/**
 * The declared sources as `{ key, id, input }`.
 *
 * @param spec - The panel.
 * @returns One entry per source, in declaration order.
 * @example
 * ```ts
 * entriesOf(spec); // [{ key: "history", id: "game.history", input: { last: 20 } }]
 * ```
 */
function entriesOf(spec: PanelSpec): Entry[] {
  return Object.entries(spec.sources).map(([key, ref]) =>
    typeof ref === "string"
      ? { key, id: ref, input: undefined }
      : { key, id: ref[0], input: ref[1] }
  );
}

/**
 * The run map of a panel: one function per command name, built once (R4).
 *
 * @param spec - The panel.
 * @param deps - link and emit.
 * @returns name → (input?) => runFromPanel(…, "panel").
 */
function runMapOf(spec: PanelSpec, deps: RunDeps): ErasedTools["run"] {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(spec.commands).map(([name, id]) => [
        name,
        (input?: Json) => runFromPanel(deps, id, input, "panel")
      ])
    )
  );
}

/**
 * The channel a view gets: link's reads and watches; runs go through runFromPanel, so even an
 * ad hoc run is reported (R4, R8).
 *
 * @param deps - link and emit.
 * @returns The EditorChannel.
 */
function channelOf(deps: RunDeps): EditorChannel {
  const { link } = deps;
  return {
    /**
     * Reads a source of the chosen game.
     *
     * @param id - Source id.
     * @param input - Source input.
     * @returns The value.
     * @example
     * ```ts
     * await tools.channel.read("game.rect", { key: "coins" });
     * ```
     */
    read(id, input) {
      return link.read(id, input);
    },
    /**
     * Watches a source; the view owns this watch and stops it itself.
     *
     * @param id - Source id.
     * @param input - Source input.
     * @param onValue - Called with every value.
     * @returns Unsubscribe.
     * @example
     * ```ts
     * const stop = tools.channel.watch("game.log", undefined, entries => show(entries));
     * ```
     */
    watch(id, input, onValue) {
      return link.watch(id, input, onValue);
    },
    /**
     * Runs a command and reports it as `workspace:ran` (origin panel).
     *
     * @param id - Command id.
     * @param input - Command input.
     * @returns The RunResult.
     * @example
     * ```ts
     * await tools.channel.run("game.pause");
     * ```
     */
    run(id, input) {
      return runFromPanel(deps, id, input, "panel");
    },
    /**
     * The current link status.
     *
     * @returns The status.
     * @example
     * ```ts
     * tools.channel.status().kind; // "live"
     * ```
     */
    status() {
      return link.status();
    }
  };
}

/**
 * The values with one key removed (a source that vanished from the manifest).
 *
 * @param panel - The mounted panel.
 * @param key - The source key.
 */
function forget(panel: MountedPanel, key: string): void {
  panel.values = Object.fromEntries(Object.entries(panel.values).filter(([name]) => name !== key));
  panel.received.delete(key);
  panel.fresh.delete(key);
}

/**
 * Schedules one render for the next frame; a second call before it runs does nothing.
 *
 * @param controller - The panel controller.
 */
function schedule(controller: Controller): void {
  const { panel } = controller;
  if (panel.scheduled || controller.unmounted) return;

  panel.scheduled = true;
  controller.deps.schedule(() => {
    panel.scheduled = false;
    if (!controller.unmounted) draw(controller);
  });
}

/**
 * Watches one source: every value is stored, marked received and fresh, and schedules a render.
 *
 * @param controller - The panel controller.
 * @param entry - The source.
 */
function watchEntry(controller: Controller, entry: Entry): void {
  const { panel } = controller;
  const stop = controller.deps.link.watch(entry.id, entry.input, value => {
    if (controller.unmounted) return;
    panel.values = { ...panel.values, [entry.key]: value };
    panel.received.add(entry.key);
    panel.fresh.add(entry.key);
    schedule(controller);
  });
  panel.unwatch.set(entry.key, stop);
}

/**
 * Brings the watches in line with a manifest: present sources are watched, absent ones are
 * unwatched and listed in `missing`. Without a manifest every source counts as present (link keeps
 * watches while disconnected, R4).
 *
 * @param controller - The panel controller.
 * @param manifest - The manifest of the chosen session, if any.
 */
function syncWatches(controller: Controller, manifest: Manifest | undefined): void {
  const { panel } = controller;
  const known = manifest === undefined ? undefined : new Set(manifest.sources.map(item => item.id));
  const missing = new Set<string>();

  for (const entry of controller.entries) {
    if (known === undefined || known.has(entry.id)) {
      if (!panel.unwatch.has(entry.key)) watchEntry(controller, entry);
      continue;
    }
    missing.add(entry.id);
    const stop = panel.unwatch.get(entry.key);
    if (stop === undefined) continue;
    stop();
    panel.unwatch.delete(entry.key);
    forget(panel, entry.key);
  }
  panel.missing = [...missing];
}

/**
 * The source ids that have not delivered a first value yet (present sources only).
 *
 * @param controller - The panel controller.
 * @returns Unique ids, in declaration order.
 */
function pendingIds(controller: Controller): string[] {
  const { panel } = controller;
  const ids = controller.entries
    .filter(entry => !panel.missing.includes(entry.id) && !panel.received.has(entry.key))
    .map(entry => entry.id);
  return [...new Set(ids)];
}

/**
 * The render state of the section (11-panels "Mount behaviour" 5).
 *
 * @param controller - The panel controller.
 * @returns error, missing, ready, no-game or waiting.
 */
function stateOf(controller: Controller): SectionState {
  if (controller.failed) return "error";
  if (controller.panel.missing.length > 0) return "missing";
  if (pendingIds(controller).length === 0) return "ready";
  return NO_GAME_KINDS.has(controller.status.kind) ? "no-game" : "waiting";
}

/**
 * The placeholder line of a state.
 *
 * @param controller - The panel controller.
 * @param state - A placeholder state.
 * @returns The text ("" while the waiting placeholder is still quiet).
 */
function placeholderText(
  controller: Controller,
  state: Exclude<SectionState, "ready" | "error">
): string {
  if (state === "no-game") return NO_GAME_TEXT;
  if (state === "missing")
    return `This game does not provide ${controller.panel.missing.join(", ")}.`;

  const ids = pendingIds(controller).join(", ");
  if (controller.phase === "spinner") return `Waiting for ${ids}…`;
  if (controller.phase === "escalated") return `No value from ${ids} yet. Check the source input.`;
  return "";
}

/**
 * Clears the waiting timers and resets the phase.
 *
 * @param controller - The panel controller.
 */
function clearTimers(controller: Controller): void {
  for (const timer of controller.timers) clearTimeout(timer);
  controller.timers = [];
  controller.phase = "quiet";
}

/**
 * Starts the 400 ms and 5 s steps when the section enters `waiting`; clears them in any other
 * state.
 *
 * @param controller - The panel controller.
 * @param state - The state being drawn.
 */
function updateTimers(controller: Controller, state: SectionState): void {
  if (state !== "waiting") {
    clearTimers(controller);
    return;
  }
  if (controller.timers.length > 0) return;

  controller.timers = [
    setTimeout(stepTo(controller, "spinner"), SPINNER_AFTER_MS),
    setTimeout(stepTo(controller, "escalated"), ESCALATE_AFTER_MS)
  ];
}

/**
 * A timer callback that moves the waiting placeholder to a phase and schedules a render.
 *
 * @param controller - The panel controller.
 * @param phase - The phase to enter.
 * @returns The callback.
 */
function stepTo(controller: Controller, phase: Phase): () => void {
  return () => {
    controller.phase = phase;
    schedule(controller);
  };
}

/**
 * The boundary's error callback: marks the panel failed, sets the error state and logs
 * `panels:view-failed` (other panels keep running).
 *
 * @param controller - The panel controller.
 * @returns The callback.
 */
function errorReporter(
  controller: Pick<Controller, "panel" | "deps" | "failed">
): (error: Error) => void {
  return error => {
    controller.failed = true;
    controller.panel.section.dataset.panelState = "error";
    controller.deps.log.error("panels:view-failed", {
      id: controller.panel.spec.id,
      message: error.message
    });
  };
}

/**
 * Sets `data-stale` from the status (11-panels "Mount behaviour" 6): silent and lost by kind,
 * empty as lost; connecting, live and paused as `resync` while a received value is not fresh.
 *
 * @param controller - The panel controller.
 */
function applyStale(controller: Controller): void {
  const { panel, status } = controller;
  const { dataset } = panel.section;
  let stale: string | undefined;

  if (status.kind === "silent" || status.kind === "lost") stale = status.kind;
  else if (status.kind === "empty") stale = "lost";
  else if ([...panel.received].some(key => !panel.fresh.has(key))) stale = "resync";

  if (stale === undefined) delete dataset.stale;
  else dataset.stale = stale;
}

/**
 * Renders the section: the view inside its boundary when ready (or failed), otherwise the
 * placeholder.
 *
 * @param controller - The panel controller.
 */
function draw(controller: Controller): void {
  const { panel, deps } = controller;
  const { section } = panel;
  const state = stateOf(controller);

  updateTimers(controller, state);
  applyStale(controller);
  section.dataset.panelState = state;

  if (state === "ready" || state === "error") {
    section.removeAttribute("aria-busy");
    const tools: ErasedTools = {
      run: controller.run,
      status: controller.status,
      channel: controller.channel,
      files: deps.link.files,
      workspace: deps.workspace
    };
    render(
      h(PanelBoundary, {
        panel: panel.spec,
        values: Object.freeze({ ...panel.values }),
        tools,
        onError: errorReporter(controller)
      }),
      section
    );
    return;
  }

  section.setAttribute("aria-busy", "true");
  render(
    h(Placeholder, {
      state,
      text: placeholderText(controller, state),
      spinner: state === "waiting" && controller.phase === "spinner"
    }),
    section
  );
}

/**
 * Creates the section of a panel and appends it to the workspace element (foreign DOM).
 *
 * @param spec - The panel.
 * @param element - The workspace element.
 * @returns The section.
 */
function createSection(spec: PanelSpec, element: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.dataset.panel = spec.id;
  section.dataset.panelState = "waiting";
  section.setAttribute("aria-label", spec.title);
  section.setAttribute("aria-busy", "true");
  section.tabIndex = -1;
  element.append(section);
  return section;
}

/**
 * Mounts one panel into a workspace element: section, watches, first render (at once).
 *
 * @param spec - The registered panel.
 * @param element - The workspace element (`workspace.host(ws)`).
 * @param deps - link, workspace, log, emit, the starting status and the frame scheduler.
 * @returns The mounted panel (setStatus, recheck, unmount).
 */
export function mountPanel(spec: PanelSpec, element: HTMLElement, deps: MountDeps): MountedPanel {
  const panel: MountedPanel = {
    spec,
    section: createSection(spec, element),
    values: {},
    received: new Set(),
    fresh: new Set(),
    unwatch: new Map(),
    missing: [],
    scheduled: false,
    /**
     * Follows a new link status.
     *
     * @param next - The status.
     */
    setStatus(next) {
      setStatus(controller, next);
    },
    /**
     * Re-checks the sources against a manifest.
     *
     * @param manifest - The manifest, undefined when the session went away.
     */
    recheck(manifest) {
      recheck(controller, manifest);
    },
    /**
     * Unwatches every source and removes the section.
     */
    unmount() {
      unmount(controller);
    }
  };
  const controller: Controller = {
    panel,
    deps,
    entries: entriesOf(spec),
    run: runMapOf(spec, deps),
    channel: channelOf(deps),
    status: deps.status,
    failed: false,
    unmounted: false,
    phase: "quiet",
    timers: []
  };

  syncWatches(controller, deps.link.manifest());
  draw(controller);
  return panel;
}

/**
 * Follows a new link status: `connecting` clears `fresh`; the stale mark follows at once and a
 * render is scheduled.
 *
 * @param controller - The panel controller.
 * @param next - The new status.
 */
function setStatus(controller: Controller, next: LinkStatus): void {
  if (controller.unmounted) return;

  controller.status = next;
  if (next.kind === "connecting") controller.panel.fresh.clear();
  applyStale(controller);
  schedule(controller);
}

/**
 * Re-checks the sources against a new manifest and schedules a render.
 *
 * @param controller - The panel controller.
 * @param manifest - The new manifest, undefined when the session went away.
 */
function recheck(controller: Controller, manifest: Manifest | undefined): void {
  if (controller.unmounted) return;

  syncWatches(controller, manifest);
  schedule(controller);
}

/**
 * Unwatches every source, clears the timers, empties and removes the section; twice is a no-op.
 *
 * @param controller - The panel controller.
 */
function unmount(controller: Controller): void {
  if (controller.unmounted) return;

  const { panel } = controller;
  controller.unmounted = true;
  clearTimers(controller);
  for (const stop of panel.unwatch.values()) stop();
  panel.unwatch.clear();
  render(undefined, panel.section);
  panel.section.remove();
}
