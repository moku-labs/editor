/**
 * @file link plugin — api factory: the remote EditorChannel plus sessions, manifest, boot, retry,
 * the frame id helpers, taps, the page heap and the files client, composed from the sub-modules.
 */
import { createFilesClient } from "./files/client";
import { gameRequest } from "./rpc/calls";
import { expectShape, readRunResult } from "./rpc/shapes";
import { chooseSession } from "./sessions/choose";
import { isOtherFrame, tagFrame } from "./sessions/frame";
import { addManifestListener, currentManifest } from "./sessions/manifest";
import { retryNow } from "./socket/connect";
import { addTapListener } from "./subscriptions/taps";
import { addWatch } from "./subscriptions/watch";
import type { LinkApi, LinkCtx } from "./types";

/**
 * Creates the link api. The contract of each member is on `LinkApi` in `types.ts`.
 *
 * @param ctx - Domain context of link.
 * @returns The LinkApi (`app.link`).
 */
export function createLinkApi(ctx: LinkCtx): LinkApi {
  const { state } = ctx;

  return {
    read: (id, input) => gameRequest(ctx, "read", input === undefined ? { id } : { id, input }),

    watch: (id, input, onValue) => addWatch(ctx, id, input, onValue),

    run: async (id, input) => {
      const result = await gameRequest(ctx, "run", input === undefined ? { id } : { id, input });
      return expectShape(result, readRunResult, "run");
    },

    status: () => ({ ...state.status }),

    manifest: () => currentManifest(state),

    onManifest: fn => addManifestListener(ctx, fn),

    sessions: () => [...state.sessions],

    session: () => state.chosen,

    choose: session => chooseSession(ctx, session),

    retry: () => {
      retryNow(ctx);
    },

    boot: () => state.boot,

    frameUrl: url => tagFrame(url, state.frame),

    isOtherTab: page => isOtherFrame(page, state.frame),

    onTap: listener => addTapListener(ctx, listener),

    heap: () => {
      const heap = state.heartbeat?.heap;
      return heap === undefined ? undefined : { ...heap };
    },

    files: createFilesClient(ctx)
  };
}
