/**
 * @file link plugin — api factory: the remote EditorChannel plus sessions, manifest, boot, retry,
 * the frame id helpers, taps, the page heap, hot reload, the editor page's selection and request
 * handlers, the project index, the computer's engine fingerprint, the published values, the
 * session listeners, the own frame's session, session-targeted runs, editor-method calls and the
 * files client, composed from the sub-modules.
 */
import { createFilesClient } from "./files/client";
import { addHandler } from "./page/requests";
import { currentSelection, notifyEditor } from "./page/selection";
import { gameRequest, request, sessionRequest } from "./rpc/calls";
import { expectShape, readRunResult } from "./rpc/shapes";
import { addEngineListener, engineIdOf } from "./server/engine";
import { addHotReloadListener, requestHotReload } from "./server/hot-reload";
import { addPublishedListener, readPublished } from "./server/published";
import { chooseSession } from "./sessions/choose";
import { isOtherFrame, tagFrame } from "./sessions/frame";
import { addSessionsListener } from "./sessions/listeners";
import { addManifestListener, currentManifest } from "./sessions/manifest";
import { ownSessionOf } from "./sessions/own";
import { retryNow } from "./socket/connect";
import { expectReload } from "./status/reload";
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

    expectReload: () => {
      expectReload(ctx);
    },

    boot: () => state.boot,

    frameUrl: (url, opts) => tagFrame(url, state.frame, opts?.player),

    isOtherTab: page => isOtherFrame(page, state.frame),

    onTap: listener => addTapListener(ctx, listener),

    heap: () => {
      const heap = state.heartbeat?.heap;
      return heap === undefined ? undefined : { ...heap };
    },

    hotReload: () => (state.hotReload === undefined ? undefined : { ...state.hotReload }),

    onHotReload: listener => addHotReloadListener(ctx, listener),

    setHotReload: on => requestHotReload(ctx, on),

    selection: () => currentSelection(state),

    notify: (method, params) => {
      notifyEditor(ctx, method, params);
    },

    handle: (method, handler) => addHandler(ctx, method, handler),

    project: () => state.project,

    engine: () => engineIdOf(state.engine),

    onEngine: listener => addEngineListener(ctx, listener),

    published: method => readPublished(state, method),

    onPublished: (method, fn) => addPublishedListener(ctx, method, fn),

    onSessions: fn => addSessionsListener(ctx, fn),

    ownSession: () => ownSessionOf(state.sessions, state.frame)?.id,

    runIn: async (session, id, input) => {
      const params = input === undefined ? { id } : { id, input };
      return expectShape(await sessionRequest(ctx, session, "run", params), readRunResult, "run");
    },

    callEditor: (method, params) => request(ctx, "editor", method, params),

    files: createFilesClient(ctx)
  };
}
