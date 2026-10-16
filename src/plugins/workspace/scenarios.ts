/**
 * @file workspace plugin — the dev-only scenario picker (spec 09 W1, W2): the prepared saves of the
 * game folder (`tests/scenarios/`, the engine's file rule), the one the game frame starts from
 * (`?player=<name>` on the frame URL, never persisted), the reload that starts it and the
 * listeners gameView's game toolbar uses. A debug build carries no scenarios: the list is the dev
 * project's.
 */
import { linkPlugin } from "../link";
import type { FileEntry } from "../registry/protocol";
import { ERROR_PREFIX, toWireError } from "../registry/protocol";
import { taggedGameUrl } from "./frame/frame";
import { nextManifest } from "./frame/reload";
import { showToast } from "./toasts";
import type { ReloadResult, ScenarioView, WorkspaceCtx, WorkspaceState } from "./types";

/**
 * The engine's scenario folder (`moku_game/src/app/serve.ts:230-243`, `generate.ts:22-23,
 * 208-220`).
 */
export const SCENARIOS_DIR = "tests/scenarios";

/**
 * A `.ts` file of the scenario folder that is not a scenario: tests, specs, declarations and the
 * folder's `index.ts` (the engine's `NOT_SCENARIO`).
 */
const NOT_SCENARIO = /\.(?:test|spec|d)\.ts$|^index\.ts$/;

/**
 * The scenario extension.
 */
const SCENARIO_EXTENSION = ".ts";

/**
 * Milliseconds in a second, for the timeout toast.
 */
const MS_PER_SECOND = 1000;

/**
 * The scenario names of a folder listing: the files whose base name ends in `.ts` and is no test,
 * spec, declaration or `index.ts`, by file stem, sorted.
 *
 * @param entries - The entries of `tests/scenarios/`.
 * @returns The names.
 * @example
 * ```ts
 * scenarioNames([{ path: "tests/scenarios/full.ts", kind: "file", size: 9 }, { path: "tests/scenarios/index.ts", kind: "file", size: 9 }]); // ["full"]
 * ```
 */
export function scenarioNames(entries: readonly FileEntry[]): string[] {
  const names: string[] = [];
  for (const entry of entries) {
    const base = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    const isScenario =
      entry.kind === "file" && base.endsWith(SCENARIO_EXTENSION) && !NOT_SCENARIO.test(base);
    if (isScenario) names.push(base.slice(0, -SCENARIO_EXTENSION.length));
  }
  return names.toSorted((left, right) => (left < right ? -1 : Number(left > right)));
}

/**
 * The scenario view of the state: a copy.
 *
 * @param state - Workspace state.
 * @returns The scenarios and the chosen one.
 */
export function scenarioView(state: WorkspaceState): ScenarioView {
  return { scenarios: [...state.scenario.list], chosen: state.scenario.chosen };
}

/**
 * True when two name lists hold the same names in the same order.
 *
 * @param left - One list.
 * @param right - The other.
 * @returns Whether they are equal.
 * @example
 * ```ts
 * sameNames(["empty", "full"], ["empty", "full"]); // true
 * ```
 */
function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/**
 * Calls every scenario listener with a fresh view and bumps the UI; a throwing listener is logged
 * and the others still run.
 *
 * @param ctx - Domain context of workspace.
 */
function notifyScenario(ctx: Pick<WorkspaceCtx, "state" | "log">): void {
  const { state } = ctx;
  for (const listener of state.scenario.listeners) {
    try {
      listener(scenarioView(state));
    } catch (error) {
      ctx.log.error(
        "workspace:scenario-listener-failed",
        {},
        error instanceof Error ? error : undefined
      );
    }
  }
  state.ui.bump();
}

/**
 * Adds a scenario listener.
 *
 * @param state - Workspace state.
 * @param fn - Called with the new view after a change.
 * @returns Removes it.
 */
export function addScenarioListener(
  state: WorkspaceState,
  fn: (view: ScenarioView) => void
): () => void {
  /**
   * A wrapper of `fn`, so the same function added twice gets two independent entries.
   *
   * @param view - The view to pass on.
   */
  const entry = (view: ScenarioView): void => {
    fn(view);
  };
  state.scenario.listeners.add(entry);
  return () => {
    state.scenario.listeners.delete(entry);
  };
}

/**
 * Lists the scenario folder once: a missing folder or a failed list gives no scenarios (a debug
 * log, no toast). A listing that settles after stop changes nothing.
 *
 * @param ctx - Domain context of workspace.
 * @returns The view after the listing.
 */
async function listScenarios(ctx: WorkspaceCtx): Promise<ScenarioView> {
  let names: string[];
  try {
    names = scenarioNames(await ctx.require(linkPlugin).files.list(SCENARIOS_DIR));
  } catch (error) {
    ctx.log.debug("workspace:scenarios-failed", { message: toWireError(error).message });
    names = [];
  }

  const { state } = ctx;
  if (state.stopped) return scenarioView(state);
  state.scenario.listed = true;
  if (!sameNames(state.scenario.list, names)) {
    state.scenario.list = names;
    notifyScenario(ctx);
  }
  return scenarioView(state);
}

/**
 * Lists `tests/scenarios/` again; concurrent calls share one listing.
 *
 * @param ctx - Domain context of workspace.
 * @returns The new view.
 */
export function refreshScenarios(ctx: WorkspaceCtx): Promise<ScenarioView> {
  const { scenario } = ctx.state;
  scenario.listing ??= listScenarios(ctx).finally(() => {
    scenario.listing = undefined;
  });
  return scenario.listing;
}

/**
 * The `link:status` part of the scenarios: the first status after start that says the socket is
 * open (not `connecting`, not `lost`) runs the first listing, once.
 *
 * @param ctx - Domain context of workspace.
 * @param kind - The kind of the new link status.
 */
export function listOnFirstOpen(ctx: WorkspaceCtx, kind: string): void {
  const { scenario } = ctx.state;
  const isOpen = kind !== "connecting" && kind !== "lost";
  if (!isOpen || scenario.listed || scenario.listing !== undefined) return;
  void refreshScenarios(ctx);
}

/**
 * The toast of a start: the scenario by name, or the saved player.
 *
 * @param chosen - The chosen scenario; undefined for the saved player.
 * @returns The toast text.
 * @example
 * ```ts
 * startToast("full"); // "Game started from scenario full"
 * ```
 */
function startToast(chosen: string | undefined): string {
  return chosen === undefined
    ? "Game started from the saved player"
    : `Game started from scenario ${chosen}`;
}

/**
 * Reloads the frame in place from the tagged URL (its `player` is the choice) and waits for this
 * tab's own new session; no bookmark, no restore: a scenario plays on a fresh memory save.
 *
 * @param ctx - Domain context of workspace.
 * @param iframe - The game frame.
 * @returns The result.
 */
async function startFrame(ctx: WorkspaceCtx, iframe: HTMLIFrameElement): Promise<ReloadResult> {
  const link = ctx.require(linkPlugin);
  const next = nextManifest(ctx, link, ctx.config.reloadTimeoutMs);
  link.expectReload();
  iframe.src = taggedGameUrl(ctx);

  const manifest = await next;
  if (manifest !== undefined) {
    showToast(ctx, startToast(ctx.state.scenario.chosen));
    return { restored: false };
  }
  if (!ctx.state.stopped) {
    const seconds = Math.round(ctx.config.reloadTimeoutMs / MS_PER_SECOND);
    showToast(ctx, `Game reloaded · no game connected after ${seconds} s`);
  }
  return { restored: false, reason: "timeout" };
}

/**
 * Starts the game frame from a scenario, or from the saved player with undefined. A name not
 * listed rejects (argument validation). Before the first mount it only stores the choice.
 *
 * @param ctx - Domain context of workspace.
 * @param name - A listed name, or undefined.
 * @returns The reload result.
 * @throws {TypeError} `[moku-editor] Unknown scenario "<name>".` for a name not listed.
 */
export async function setScenario(
  ctx: WorkspaceCtx,
  name: string | undefined
): Promise<ReloadResult> {
  const { state } = ctx;
  if (name !== undefined && !state.scenario.list.includes(name)) {
    throw new TypeError(
      `${ERROR_PREFIX}Unknown scenario "${name}".\n  Pick one of workspace.scenarios().`
    );
  }

  state.scenario.chosen = name;
  notifyScenario(ctx);
  const { iframe } = state.frame;
  if (iframe === undefined) return { restored: false, reason: "not_mounted" };
  return startFrame(ctx, iframe);
}
