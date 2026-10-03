/**
 * @file workspace plugin — D1, the step result popover (top layer, Esc layer `stepPopover`,
 * closes after 4 s): "ok · game.step · frames: 1" with the run state, or the wire error code and
 * its bare message (the `[moku-editor] ` prefix stripped, R7).
 */
import type { VNode } from "preact";
import { useEffect } from "preact/hooks";
import { bareMessage } from "../../registry/protocol";
import { closePopover } from "../actions";
import type { RanEvent, WorkspaceCtx } from "../types";
import { usePopover } from "./popover";
import { useElement, useWorkspace } from "./store";
import { inputText } from "./text";

/**
 * Props of `StepPopover`.
 */
export type StepPopoverProps = { readonly ctx: WorkspaceCtx };

/**
 * How long the popover stays open.
 */
const CLOSE_AFTER_MS = 4000;

/**
 * The body of a step result.
 *
 * @param props - The run.
 * @param props.ran - The settled step run.
 * @returns The lines.
 * @example
 * ```tsx
 * <StepResult ran={state.step} />
 * ```
 */
function StepResult(props: { readonly ran: RanEvent }): VNode {
  const { ran } = props;
  if (ran.ok) {
    const { path, frame, tainted } = ran.result.state;
    return (
      <>
        <p data-head>
          <span data-tag="ok">ok</span> · {ran.id} · {inputText(ran.input)}
        </p>
        <pre data-mono>{`{ path: "${path}", frame: ${frame}, tainted: ${tainted} }`}</pre>
      </>
    );
  }
  const field = ran.error.data?.field;
  return (
    <>
      <p data-head>
        <span data-tag="err">error</span> · {field === undefined ? ran.id : `field: ${field}`}
      </p>
      <p data-mono>{`${ran.error.code} ${bareMessage(ran.error.message)}`}</p>
      <p data-muted>Logged in Console</p>
    </>
  );
}

/**
 * The step result popover.
 *
 * @param props - The workspace domain context.
 * @returns The popover.
 * @example
 * ```tsx
 * <StepPopover ctx={ctx} />
 * ```
 */
export function StepPopover(props: StepPopoverProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const element = useElement<HTMLElement>();
  const ran = state.step;
  const open = state.popover === "step" && ran !== undefined;
  usePopover(element, open, state, "step");

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => closePopover(state, "step"), CLOSE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [open, ran, state]);

  return (
    <section
      data-ui="step-popover"
      data-ok={ran?.ok === false ? "false" : "true"}
      popover="manual"
      aria-label="Step result"
      ref={element.ref}
    >
      {open && <StepResult ran={ran} />}
    </section>
  );
}
