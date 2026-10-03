/**
 * @file workspace plugin — F3, the stale bar above the workspace hosts while the link is silent
 * (warn) or lost (error) after the game was live once: which frame the data is from and why, with
 * "Retry now" when lost. No backdrop blur; panels fade their own data areas (`data-stale`).
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import type { WorkspaceCtx } from "../types";
import { useWorkspace } from "./store";
import { lostReason, secondsOf, secondsSince } from "./text";

/**
 * Props of `StaleBar`.
 */
export type StaleBarProps = { readonly ctx: WorkspaceCtx };

/**
 * The stale bar.
 *
 * @param props - The workspace domain context.
 * @returns The bar (hidden while the data is fresh).
 */
export function StaleBar(props: StaleBarProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const status = state.link;

  if (!state.everLive || (status.kind !== "silent" && status.kind !== "lost")) {
    return <div data-ui="stale-bar" hidden />;
  }
  if (status.kind === "silent") {
    const seconds = secondsSince(status.since, Date.now());
    return (
      <div data-ui="stale-bar" data-tone="warn" role="status">
        Stale · data from frame {status.lastFrame} · no heartbeat for {seconds} s · the game tab may
        be in the background
      </div>
    );
  }
  return (
    <div data-ui="stale-bar" data-tone="error" role="status">
      <span>
        Stale · data from frame {status.lastFrame} · {lostReason(status.reason)}, reconnecting in{" "}
        {secondsOf(status.retryInMs)} s ·{" "}
      </span>
      <button type="button" data-size="sm" onClick={() => ctx.require(linkPlugin).retry()}>
        Retry now
      </button>
    </div>
  );
}
