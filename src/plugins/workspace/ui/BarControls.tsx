/**
 * @file workspace plugin — the two control shapes of the top bar: a labelled `role="switch"` and a
 * ghost button. A control that cannot act now is `aria-disabled` (not `disabled`), so its tooltip
 * still explains why, and its click does nothing.
 */
import type { ComponentChildren, VNode } from "preact";

/**
 * Props of a top-bar switch.
 */
export type SwitchProps = {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly title: string;
  readonly name: string;
  readonly onToggle: () => void;
};

/**
 * A labelled `role="switch"` button.
 *
 * @param props - Label, state and the toggle action.
 * @returns The switch.
 * @example
 * ```tsx
 * <Switch name="game" label="Preview" checked disabled={false} title="Game preview (G)" onToggle={toggle} />
 * ```
 */
export function Switch(props: SwitchProps): VNode {
  return (
    <button
      type="button"
      role="switch"
      data-switch
      data-action={props.name}
      aria-checked={props.checked}
      aria-disabled={props.disabled}
      title={props.title}
      onClick={() => {
        if (!props.disabled) props.onToggle();
      }}
    >
      <span data-track aria-hidden="true" />
      <span>{props.label}</span>
    </button>
  );
}

/**
 * Props of a top-bar ghost button.
 */
export type BarButtonProps = {
  /** `data-action` value. */
  readonly name: string;
  /** Tooltip. */
  readonly title: string;
  /** aria-disabled; the click does nothing then. */
  readonly disabled?: boolean;
  /** `data-popover-anchor` value for a popover placed under it. */
  readonly anchor?: string;
  /** `aria-pressed` for a toggle button; omitted for a plain one. */
  readonly pressed?: boolean;
  /** The action. */
  readonly onClick: () => void;
  /** Icon and text. */
  readonly children: ComponentChildren;
};

/**
 * A ghost button of the top bar.
 *
 * @param props - The action name, tooltip, disabled state, click handler and content.
 * @returns The button.
 * @example
 * ```tsx
 * <BarButton name="step" title="Step 1 frame (.)" disabled={false} onClick={step}>Step</BarButton>
 * ```
 */
export function BarButton(props: BarButtonProps): VNode {
  return (
    <button
      type="button"
      data-variant="ghost"
      data-action={props.name}
      data-popover-anchor={props.anchor}
      aria-disabled={props.disabled === true}
      aria-pressed={props.pressed}
      title={props.title}
      onClick={() => {
        if (props.disabled !== true) props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}
