/**
 * @file overlay plugin — the toast line of the Game and Record tabs (F2).
 */
import type { VNode } from "preact";
import type { ToastView } from "../model/types";

/**
 * The toast line.
 *
 * @param props - The toast.
 * @param props.toast - Text and tone.
 * @returns The status line.
 */
export function Toast(props: { readonly toast: ToastView }): VNode {
  return (
    <p role="status" data-toast={props.toast.tone}>
      {props.toast.text}
    </p>
  );
}
