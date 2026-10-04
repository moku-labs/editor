/**
 * @file workspace plugin — the ⋯ menu of the compact top bar (below 900 px, round 2 R1): the ⋯
 * button (`data-action="more"`) and a top-layer `role="menu"` popover holding the controls the
 * narrow bar has no room for. Toggle rows (Game preview G, Overlay in game O, Reference mode R,
 * Hot reload H) show their state and key and keep the menu open; Registry opens the registry
 * popover; Density cycles auto → compact → comfortable; Theme flips the theme. A second ⋯ click,
 * Esc (layer `contextMenu`) or a press outside closes it; ↑/↓ move through the rows.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { linkPlugin } from "../../link";
import { closePopover, openPopover } from "../actions";
import { chooseDensity, chooseTheme } from "../prefs/apply";
import { DENSITY_CHOICES } from "../prefs/density";
import { effectiveTheme } from "../prefs/theme";
import type { WorkspaceCtx, WorkspaceState } from "../types";
import {
  hotReloadControl,
  overlayControl,
  previewControl,
  referenceControl,
  registryCounts,
  registryTitle,
  type ToggleControl
} from "./controls";
import { Icon } from "./icons";
import { usePopover } from "./popover";
import { type ElementHolder, useElement, useWorkspace } from "./store";

/**
 * Props of `MoreMenu`.
 */
export type MoreMenuProps = { readonly ctx: WorkspaceCtx };

/**
 * The selector of every row.
 */
const ROWS = "[role^='menuitem']";

/**
 * A toggle row: label, state, key.
 *
 * @param props - The control.
 * @param props.control - What the row shows and does.
 * @returns The row.
 * @example
 * ```tsx
 * <ToggleRow control={referenceControl(ctx)} />
 * ```
 */
function ToggleRow(props: { readonly control: ToggleControl }): VNode {
  const { control } = props;
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      data-action={control.name}
      aria-checked={control.checked}
      aria-disabled={control.disabled}
      title={control.title}
      onClick={() => {
        if (!control.disabled) control.toggle();
      }}
    >
      <span data-part="label">{control.label}</span>
      <span data-part="state">{control.state}</span>
      <kbd>{control.key}</kbd>
    </button>
  );
}

/**
 * A value row: label and the current value; the click acts.
 *
 * @param props - Action name, label, value, tooltip and the action.
 * @param props.name - `data-action` value.
 * @param props.label - The row label.
 * @param props.value - The current value.
 * @param props.title - Tooltip.
 * @param props.onClick - The action.
 * @returns The row.
 * @example
 * ```tsx
 * <ValueRow name="theme" label="Theme" value="light" title="Theme: dark" onClick={flip} />
 * ```
 */
function ValueRow(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly title: string;
  readonly onClick: () => void;
}): VNode {
  return (
    <button
      type="button"
      role="menuitem"
      data-action={props.name}
      title={props.title}
      onClick={props.onClick}
    >
      <span data-part="label">{props.label}</span>
      <span data-part="state">{props.value}</span>
    </button>
  );
}

/**
 * Moves the focus to the next or the previous row, wrapping around; from outside the rows it
 * starts at the first (down) or the last (up).
 *
 * @param menu - The menu element.
 * @param step - 1 for down, -1 for up.
 */
function moveFocus(menu: HTMLElement, step: 1 | -1): void {
  const rows = [...menu.querySelectorAll<HTMLElement>(ROWS)];
  if (rows.length === 0) return;

  const active = menu.ownerDocument.activeElement;
  const index = active instanceof HTMLElement ? rows.indexOf(active) : -1;
  const start = step === 1 ? 0 : rows.length - 1;
  const next = index === -1 ? start : index + step;
  rows.at(next % rows.length)?.focus();
}

/**
 * Closes the menu on a press outside it and outside its ⋯ button, while it is open.
 *
 * @param state - Workspace state.
 * @param open - Whether the menu is open.
 * @param menu - The menu element.
 * @param button - The ⋯ button.
 */
function useLightDismiss(
  state: WorkspaceState,
  open: boolean,
  menu: ElementHolder<HTMLElement>,
  button: ElementHolder<HTMLButtonElement>
): void {
  useLayoutEffect(() => {
    const document = globalThis.document;
    if (!open || document === undefined) return;

    /**
     * Closes the menu unless the press is inside it or on its button.
     *
     * @param event - The pointerdown.
     */
    const onPress = (event: Event): void => {
      const target = event.target;
      const inside =
        target instanceof Node &&
        (menu.current?.contains(target) === true || button.current?.contains(target) === true);
      if (!inside) closePopover(state, "more");
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
    };
  }, [open]);
}

/**
 * The rows of the menu, in order.
 *
 * @param props - The workspace domain context.
 * @param props.ctx - Domain context of workspace.
 * @returns The rows.
 */
function MenuRows(props: { readonly ctx: WorkspaceCtx }): VNode {
  const { ctx } = props;
  const { state } = ctx;
  const manifest = ctx.require(linkPlugin).manifest();
  const density = state.density.chosen;
  const nextDensity =
    DENSITY_CHOICES[(DENSITY_CHOICES.indexOf(density) + 1) % DENSITY_CHOICES.length] ?? "auto";
  const theme = effectiveTheme(state.theme);
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <>
      <ToggleRow control={previewControl(ctx)} />
      <ToggleRow control={overlayControl(ctx)} />
      <ToggleRow control={referenceControl(ctx)} />
      <ToggleRow control={hotReloadControl(ctx)} />
      <hr data-part="separator" />
      <ValueRow
        name="registry"
        label="Registry"
        value={registryCounts(manifest)}
        title={registryTitle(manifest)}
        onClick={() => openPopover(state, "registry")}
      />
      <ValueRow
        name="density"
        label="Density"
        value={density}
        title={`Density: ${nextDensity}`}
        onClick={() => chooseDensity(ctx, nextDensity)}
      />
      <ValueRow
        name="theme"
        label="Theme"
        value={theme}
        title={`Theme: ${nextTheme}`}
        onClick={() => chooseTheme(ctx)}
      />
    </>
  );
}

/**
 * The ⋯ button and its menu.
 *
 * @param props - The workspace domain context.
 * @returns The button and the popover.
 */
export function MoreMenu(props: MoreMenuProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const menu = useElement<HTMLElement>();
  const button = useElement<HTMLButtonElement>();
  const [focusFirst, setFocusFirst] = useState(false);
  const open = state.popover === "more";
  usePopover(menu, open, state, "more");
  useLightDismiss(state, open, menu, button);

  // A keyboard open (Enter or Space on ⋯) moves the focus into the menu.
  useLayoutEffect(() => {
    if (!open || !focusFirst) return;
    menu.current?.querySelector<HTMLElement>(ROWS)?.focus();
    setFocusFirst(false);
  }, [open, focusFirst]);

  return (
    <>
      <button
        type="button"
        data-variant="ghost"
        data-action="more"
        data-popover-anchor="more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        title="More: preview, overlay, Reference mode, hot reload, registry, density, theme"
        ref={button.ref}
        onClick={event => {
          if (open) {
            closePopover(state, "more");
            return;
          }
          setFocusFirst(event.detail === 0);
          openPopover(state, "more");
        }}
      >
        <Icon name="more" />
      </button>
      <div
        data-ui="more-menu"
        popover="manual"
        role="menu"
        aria-label="More"
        ref={menu.ref}
        onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (menu.current !== undefined)
            moveFocus(menu.current, event.key === "ArrowDown" ? 1 : -1);
        }}
      >
        {open && <MenuRows ctx={ctx} />}
      </div>
    </>
  );
}
