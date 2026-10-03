/**
 * @file consoleView plugin — api factory and its actions: filter, clear, Preserve log, selection,
 * refresh, frame links and the view subscription. The contract of each member lives on
 * ConsoleApi in types.ts.
 */
import { pushBadge } from "./badge";
import { countLevels, visibleLines } from "./filter";
import { pushMeta } from "./ingest";
import { notify, subscribe } from "./state";
import type { ConsoleApi, ConsoleCtx, LevelFilter, LogLine } from "./types";
import { readOnce } from "./watch";

/**
 * Merges a partial filter and notifies.
 *
 * @param ctx - Domain context of consoleView.
 * @param next - The level, the query, or both.
 * @example
 * ```ts
 * setFilter(ctx, { level: "warn" }); // ctx.state.level === "warn"
 * ```
 */
function setFilter(ctx: ConsoleCtx, next: Partial<{ level: LevelFilter; query: string }>): void {
  const { state } = ctx;
  if (next.level !== undefined) state.level = next.level;
  if (next.query !== undefined) state.query = next.query;
  notify(state);
}

/**
 * Empties the console to the "Console cleared" meta row; `consumed` stays, so cleared entries
 * never come back. Clears the badge and notifies.
 *
 * @param ctx - Domain context of consoleView.
 * @example
 * ```ts
 * clearConsole(ctx); // ctx.state.lines → [{ kind: "meta", text: "Console cleared", … }]
 * ```
 */
export function clearConsole(ctx: ConsoleCtx): void {
  const { state, config } = ctx;
  state.lines = [];
  pushMeta(state, "Console cleared", config.maxLines);
  state.selected = undefined;
  pushBadge(ctx);
  notify(state);
}

/**
 * Sets Preserve log and notifies.
 *
 * @param ctx - Domain context of consoleView.
 * @param on - The new value.
 * @example
 * ```ts
 * setPreserve(ctx, true); // ctx.state.preserve === true
 * ```
 */
export function setPreserve(ctx: ConsoleCtx, on: boolean): void {
  ctx.state.preserve = on;
  notify(ctx.state);
}

/**
 * Selects the drawer line and notifies.
 *
 * @param ctx - Domain context of consoleView.
 * @param key - The line key, or undefined to close the drawer.
 * @example
 * ```ts
 * select(ctx, 5); // ctx.state.selected === 5
 * ```
 */
function select(ctx: ConsoleCtx, key?: number): void {
  ctx.state.selected = key;
  notify(ctx.state);
}

/**
 * The drawer line, if still held.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The line, or undefined.
 * @example
 * ```ts
 * selectedLine(ctx)?.key; // 5 after select(ctx, 5)
 * ```
 */
function selectedLine(ctx: ConsoleCtx): LogLine | undefined {
  const { selected, lines } = ctx.state;
  return selected === undefined ? undefined : lines.find(line => line.key === selected);
}

/**
 * Creates the consoleView api over the plugin state.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The api.
 * @example
 * ```ts
 * createToolsPlugin("consoleView", { api: createConsoleApi }); // app.consoleView.counts()
 * ```
 */
export function createConsoleApi(ctx: ConsoleCtx): ConsoleApi {
  const { state } = ctx;
  return {
    /** @inheritDoc */
    lines: () => [...state.lines],
    /** @inheritDoc */
    visible: () => visibleLines(state.lines, state.level, state.query),
    /** @inheritDoc */
    counts: () => countLevels(state.lines),
    /** @inheritDoc */
    filter: () => ({ level: state.level, query: state.query }),
    /** @inheritDoc */
    setFilter: next => setFilter(ctx, next),
    /** @inheritDoc */
    clear: () => clearConsole(ctx),
    /** @inheritDoc */
    preserve: () => state.preserve,
    /** @inheritDoc */
    setPreserve: on => setPreserve(ctx, on),
    /** @inheritDoc */
    select: key => select(ctx, key),
    /** @inheritDoc */
    selected: () => selectedLine(ctx),
    /** @inheritDoc */
    refresh: () => {
      void readOnce(ctx);
    },
    /** @inheritDoc */
    focusFrame: frame => ctx.emit("workspace:focus-frame", { frame }),
    /** @inheritDoc */
    subscribe: fn => subscribe(state, fn)
  };
}
