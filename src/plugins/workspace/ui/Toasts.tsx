/**
 * @file workspace plugin — F1, the toast region: a `popover="manual"` output at the bottom centre
 * (top layer, above the game frame), one line per toast, the file in mono after a middle dot;
 * pointer over a toast or focus in it pauses its timer.
 */
import type { VNode } from "preact";
import { pauseToast, resumeToast } from "../toasts";
import type { WorkspaceCtx } from "../types";
import { usePopover } from "./popover";
import { useElement, useWorkspace } from "./store";

/**
 * Props of `Toasts`.
 */
export type ToastsProps = { readonly ctx: WorkspaceCtx };

/**
 * The toast region.
 *
 * @param props - The workspace domain context.
 * @returns The region.
 * @example
 * ```tsx
 * <Toasts ctx={ctx} />
 * ```
 */
export function Toasts(props: ToastsProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const region = useElement<HTMLElement>();
  usePopover(region, state.toasts.length > 0, state);

  return (
    <output data-ui="toasts" popover="manual" aria-live="polite" ref={region.ref}>
      {state.toasts.map(toast => (
        <p
          key={toast.id}
          data-toast
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus pauses the toast so a keyboard user can read it
          tabIndex={0}
          onPointerEnter={() => pauseToast(ctx, toast.id)}
          onPointerLeave={() => resumeToast(ctx, toast.id)}
          onFocus={() => pauseToast(ctx, toast.id)}
          onBlur={() => resumeToast(ctx, toast.id)}
        >
          <span>{toast.message}</span>
          {toast.file !== undefined && (
            <>
              <span aria-hidden="true"> · </span>
              <code>{toast.file}</code>
            </>
          )}
        </p>
      ))}
    </output>
  );
}
