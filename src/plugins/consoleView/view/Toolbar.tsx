/**
 * @file consoleView plugin — the Console toolbar: level segmented control with counts, search
 * (focused by "/", Esc clears it), Clear and the Preserve log switch.
 */
import type { JSX, VNode } from "preact";
import { useCallback } from "preact/hooks";
import type { ConsoleApi, ConsoleCtx, LevelCounts, LevelFilter } from "../types";

/**
 * Props of `Toolbar`.
 *
 * @example
 * ```tsx
 * const props: ToolbarProps = { ctx, api, counts, level: "all", query: "", preserve: false };
 * ```
 */
export type ToolbarProps = {
  readonly ctx: ConsoleCtx;
  readonly api: ConsoleApi;
  readonly counts: LevelCounts;
  readonly level: LevelFilter;
  readonly query: string;
  readonly preserve: boolean;
};

/**
 * The segments of the level control, in order.
 */
const FILTERS: readonly LevelFilter[] = ["all", "info", "warn", "error"];

/**
 * The colour of a segment count: warn amber and error red when non-zero.
 *
 * @param filter - The segment.
 * @param count - Its count.
 * @returns The `data-tone` value, or undefined.
 * @example
 * ```ts
 * toneOf("error", 1); // "error"
 * ```
 */
function toneOf(filter: LevelFilter, count: number): "warn" | "error" | undefined {
  if (count === 0) return undefined;
  if (filter === "warn") return "warn";
  return filter === "error" ? "error" : undefined;
}

/**
 * Esc inside the search: closes the drawer first, then clears and blurs the field. A local
 * handler, not a global Esc layer.
 *
 * @param api - The console api.
 * @param event - The keydown event.
 * @example
 * ```ts
 * onSearchKey(api, new KeyboardEvent("keydown", { key: "Escape" })); // api.filter().query → ""
 * ```
 */
function onSearchKey(api: ConsoleApi, event: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
  if (event.key !== "Escape") return;

  event.preventDefault();
  event.stopPropagation();
  if (api.selected() !== undefined) {
    api.select();
    return;
  }
  api.setFilter({ query: "" });
  event.currentTarget.blur();
}

/**
 * The Console toolbar (one 40 px row).
 *
 * @param props - The ctx, the api and what this render shows.
 * @returns The toolbar element.
 * @example
 * ```tsx
 * <Toolbar ctx={ctx} api={api} counts={api.counts()} level="all" query="" preserve={false} />
 * ```
 */
export function Toolbar(props: ToolbarProps): VNode {
  const { ctx, api, counts, level, query, preserve } = props;
  // The "/" binding of startConsole focuses the field registered here.
  const register = useCallback(
    (element: HTMLInputElement | null) => {
      ctx.state.searchEl = element ?? undefined;
    },
    [ctx]
  );

  return (
    <div data-part="toolbar" role="toolbar" aria-label="Console">
      <div data-segmented role="radiogroup" aria-label="Level">
        {FILTERS.map(filter => (
          // biome-ignore lint/a11y/useSemanticElements: a segment is a button acting as a radio (design A6 level filter)
          <button
            key={filter}
            type="button"
            role="radio"
            aria-checked={level === filter}
            data-level={filter}
            onClick={() => api.setFilter({ level: filter })}
          >
            {filter}{" "}
            <span data-count data-tone={toneOf(filter, counts[filter])}>
              {counts[filter]}
            </span>
          </button>
        ))}
      </div>
      <input
        ref={register}
        type="search"
        data-search
        placeholder="Search the log"
        aria-label="Search the log"
        value={query}
        onInput={event => api.setFilter({ query: event.currentTarget.value })}
        onKeyDown={event => onSearchKey(api, event)}
      />
      <button type="button" data-variant="ghost" title="Clear the console" onClick={api.clear}>
        Clear
      </button>
      <button
        type="button"
        role="switch"
        data-switch
        aria-checked={preserve}
        onClick={() => api.setPreserve(!preserve)}
      >
        <span data-track aria-hidden="true" />
        Preserve log
      </button>
    </div>
  );
}
