/**
 * @file workspace plugin — F4, the card centred over the content: "No game connected" with the
 * game URL and Copy (also for a page without a boot tag), or "Connecting · Waiting for the game
 * at <url>" with a spinner while the game was never live in this page. While a card shows, the
 * hosts are inert and faded.
 */
import type { VNode } from "preact";
import { gameUrl } from "../frame/frame";
import { showToast } from "../toasts";
import type { WorkspaceCtx, WorkspaceState } from "../types";
import { Icon } from "./icons";
import { useWorkspace } from "./store";

/**
 * Props of `StatusCard`.
 */
export type StatusCardProps = { readonly ctx: WorkspaceCtx };

/**
 * Which card shows now. A page without a boot tag (lost `no_boot`) can never connect, so it gets
 * the empty card, not the connecting one.
 *
 * @param state - Workspace state.
 * @returns "empty", "connecting" or undefined for none.
 * @example
 * ```ts
 * cardKind(ctx.state); // "connecting" before the first session
 * ```
 */
export function cardKind(state: WorkspaceState): "empty" | "connecting" | undefined {
  const { link } = state;
  const { kind } = link;
  if (kind === "empty") return "empty";
  if (kind === "lost" && link.reason === "no_boot") return "empty";
  if (kind === "live" || kind === "paused" || state.everLive) return undefined;
  return "connecting";
}

/**
 * Copies the game URL and toasts.
 *
 * @param ctx - Domain context of workspace.
 * @param url - The game URL.
 * @example
 * ```ts
 * copyUrl(ctx, url);
 * ```
 */
function copyUrl(ctx: WorkspaceCtx, url: string): void {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) return;
  clipboard
    .writeText(url)
    .then(() => showToast(ctx, "Copied URL"))
    .catch((error: unknown) => {
      ctx.log.warn("workspace:copy-failed", { error: String(error) });
    });
}

/**
 * The status card.
 *
 * @param props - The workspace domain context.
 * @returns The card (hidden while a game is connected).
 * @example
 * ```tsx
 * <StatusCard ctx={ctx} />
 * ```
 */
export function StatusCard(props: StatusCardProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const card = cardKind(state);
  const url = gameUrl(ctx);

  if (card === undefined) return <section data-ui="status-card" hidden />;
  if (card === "connecting") {
    return (
      <section data-ui="status-card" data-card data-kind="connecting" role="status">
        <span data-spinner aria-hidden="true" />
        <h2>Connecting</h2>
        <p>
          Waiting for the game at <span data-mono>{url}</span>
        </p>
      </section>
    );
  }
  return (
    <section data-ui="status-card" data-card data-kind="empty" role="status">
      <h2>No game connected</h2>
      <p>Open the game page to connect it:</p>
      <p data-url>
        <span data-mono>{url}</span>
        <button type="button" data-size="sm" onClick={() => copyUrl(ctx, url)}>
          <Icon name="copy" />
          <span>Copy</span>
        </button>
      </p>
    </section>
  );
}
