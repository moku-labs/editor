/**
 * @file filesView plugin — the open-file tabs: one tab per file (basename, full path as title),
 * the modified dot that turns into a close × on hover or focus, middle click closes, ←/→ move
 * between tabs; the discard popover (browser top layer) for a modified tab.
 */
import type { VNode } from "preact";
import { useEffect } from "preact/hooks";
import { dismissConfirm } from "../tabs/edit";
import { isModified } from "../tabs/model";
import { activateTab, closeTab } from "../tabs/open";
import { nameOf } from "../tree/model";
import type { FilesViewCtx } from "../types";
import { useElement } from "./useFiles";

/**
 * Props of `Tabs`.
 *
 * @example
 * ```tsx
 * <Tabs ctx={ctx} />
 * ```
 */
export type TabsProps = { readonly ctx: FilesViewCtx };

/**
 * Shows a popover element in the top layer, where the browser supports it (it is removed from
 * the DOM when it closes, which also leaves the top layer).
 *
 * @param element - The popover element, when rendered.
 * @example
 * ```ts
 * showInTopLayer(dialog);
 * ```
 */
function showInTopLayer(element: HTMLElement | undefined): void {
  if (element === undefined || typeof element.showPopover !== "function") return;
  if (!element.matches(":popover-open")) element.showPopover();
}

/**
 * The tab strip and the discard popover.
 *
 * @param props - Context.
 * @returns The tabs.
 * @example
 * ```tsx
 * <Tabs ctx={ctx} />
 * ```
 */
export function Tabs(props: TabsProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  const strip = useElement<HTMLElement>();
  const popover = useElement<HTMLElement>();
  const confirm = state.confirmClose;

  useEffect(() => {
    showInTopLayer(popover.current);
  }, [confirm, popover]);

  /**
   * Activates the tab next to the active one and focuses it.
   *
   * @param step - -1 for left, 1 for right.
   * @example
   * ```ts
   * move(1);
   * ```
   */
  const move = (step: number): void => {
    const position = state.tabs.findIndex(tab => tab.path === state.active);
    const next = state.tabs[position + step];
    if (next === undefined) return;
    activateTab(ctx, next.path);
    const tabs = strip.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [];
    for (const tab of tabs) if (tab.title === next.path) tab.focus();
  };

  return (
    <div data-part="tabs">
      <div
        role="tablist"
        data-tabs
        aria-label="Open files"
        ref={strip.ref}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        }}
      >
        {state.tabs.map(tab => {
          const name = nameOf(tab.path);
          const modified = isModified(tab);
          const active = tab.path === state.active;
          return (
            <div key={tab.path} data-tab data-active={active ? "" : undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={tab.path}
                tabIndex={active ? 0 : -1}
                onClick={() => activateTab(ctx, tab.path)}
                onMouseDown={event => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={event => {
                  if (event.button === 1) closeTab(ctx, tab.path, false);
                }}
              >
                {name}
              </button>
              <button
                type="button"
                data-close
                data-modified={modified ? "" : undefined}
                aria-label={modified ? `Close ${name} · modified` : `Close ${name}`}
                tabIndex={-1}
                onClick={() => closeTab(ctx, tab.path, false)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {confirm !== undefined && (
        <div
          data-discard
          popover="manual"
          role="dialog"
          aria-label="Discard changes"
          ref={popover.ref}
        >
          <p>Discard changes to {nameOf(confirm)}?</p>
          <button type="button" data-variant="danger" onClick={() => closeTab(ctx, confirm, true)}>
            Discard
          </button>
          <button type="button" data-variant="ghost" onClick={() => dismissConfirm(ctx)}>
            Keep
          </button>
        </div>
      )}
    </div>
  );
}
