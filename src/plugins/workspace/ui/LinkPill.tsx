/**
 * @file workspace plugin — the link pill of the top bar: one look per link status (connecting,
 * live, paused, silent with the seconds since the last heartbeat, lost with "Retry now", empty)
 * and the D7 status note as its tooltip and description.
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import type { LinkStatus } from "../../registry/protocol";
import type { WorkspaceCtx } from "../types";
import { useWorkspace } from "./store";
import { capitalize, lostReason, secondsOf, secondsSince } from "./text";

/**
 * Props of `LinkPill`.
 */
export type LinkPillProps = { readonly ctx: WorkspaceCtx };

/**
 * Id of the D7 note element.
 */
const NOTE_ID = "moku-link-note";

/**
 * The pill text and the D7 note of a status.
 *
 * @param status - The link status.
 * @param now - Epoch ms now.
 * @returns The text and the note.
 * @example
 * ```ts
 * pillText({ kind: "live", frame: 1840 }, Date.now()).text; // "Live · f1840"
 * ```
 */
export function pillText(status: LinkStatus, now: number): { text: string; note: string } {
  switch (status.kind) {
    case "connecting": {
      return { text: "Connecting", note: "Waiting for the game page to connect" };
    }
    case "live": {
      return { text: `Live · f${status.frame}`, note: `Game connected · frame ${status.frame}` };
    }
    case "paused": {
      return {
        text: `Paused · f${status.frame}`,
        note: `Game paused at frame ${status.frame} · step with .`
      };
    }
    case "silent": {
      const seconds = secondsSince(status.since, now);
      return {
        text: `No heartbeat · ${seconds} s`,
        note: `No heartbeat for ${seconds} s · the game tab may be in the background`
      };
    }
    case "lost": {
      const retry = secondsOf(status.retryInMs);
      return {
        text: `Lost · retry in ${retry} s`,
        note: `${capitalize(lostReason(status.reason))} · reconnecting in ${retry} s`
      };
    }
    default: {
      return { text: "No game", note: "No game connected · open the game page" };
    }
  }
}

/**
 * The link pill.
 *
 * @param props - The workspace domain context.
 * @returns The pill.
 */
export function LinkPill(props: LinkPillProps): VNode {
  const { ctx } = props;
  const status = useWorkspace(ctx.state.ui, () => ctx.state.link);
  const { text, note } = pillText(status, Date.now());

  return (
    <span data-ui="link-pill" data-kind={status.kind} title={note} aria-describedby={NOTE_ID}>
      <span data-dot aria-hidden="true" />
      <span data-text>{text}</span>
      <span id={NOTE_ID} hidden>
        {note}
      </span>
      {status.kind === "lost" && (
        <button
          type="button"
          data-size="sm"
          data-variant="ghost"
          onClick={() => ctx.require(linkPlugin).retry()}
        >
          Retry now
        </button>
      )}
    </span>
  );
}
