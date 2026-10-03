/**
 * @file flowView inspector module — the inspector actions behind the Inspector tabs, the palette
 * items and the hooks: tabs, the Code tab (read, edit, save, reload), the Styles tab (cards,
 * steppers, keys for the palette), node files, "Open in Files" (R4) and "Open in editor" (D-08).
 */
import { editorUrlOf } from "../../panels/shared/editor-url";
import { isStyleEditError, loadStyleFile } from "../../panels/shared/style-edit";
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment, NodeId } from "../types";
import { lookupOf, openCode, reloadCode, saveCode } from "./code";
import { fileOfNode, lineOf } from "./files";
import { keysOf, openStyles, stepStyle, usedByOf } from "./styles";
import type { InspectorActions } from "./types";

/**
 * The node the Inspector shows: the selected node, else the current one.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The node id, or undefined.
 */
export function shownNode(ctx: FlowCtx, env: FlowEnvironment): NodeId | undefined {
  const selected = ctx.state.focus.selected;
  const item = selected === undefined ? undefined : ctx.state.layout.result?.byKey[selected];
  if (item !== undefined && item.kind !== "note" && item.kind !== "stub" && item.kind !== "port") {
    return item.id;
  }
  return env.actions().focus.current();
}

/**
 * Creates the inspector actions.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and the late-bound actions.
 * @returns The inspector actions.
 */
export function createInspectorApi(ctx: FlowCtx, env: FlowEnvironment): InspectorActions {
  const { inspector } = ctx.state;
  let request = 0;

  const actions: InspectorActions = {
    setTab: tab => {
      inspector.tab = tab;
      notify(ctx.state);
      const node = shownNode(ctx, env);
      if (tab === "code" && node !== undefined) actions.openCode(node).catch(() => {});
      if (tab === "styles" && inspector.styles === undefined) actions.openStyles().catch(() => {});
    },

    openCode: async id => {
      request += 1;
      const mine = request;
      await openCode(ctx, env, id, () => mine === request);
    },

    edit: () => {
      const code = inspector.code;
      if (code === undefined) return;
      code.draft = code.text;
      code.discard = false;
      code.result = undefined;
      notify(ctx.state);
    },

    setDraft: text => {
      const code = inspector.code;
      if (code === undefined) return;
      code.draft = text;
      code.discard = false;
      notify(ctx.state);
    },

    cancelEdit: () => {
      const code = inspector.code;
      if (code?.draft === undefined) return false;
      if (code.draft !== code.text && !code.discard) {
        code.discard = true;
        notify(ctx.state);
        return true;
      }
      actions.discard();
      return true;
    },

    discard: () => {
      const code = inspector.code;
      if (code === undefined) return;
      code.draft = undefined;
      code.discard = false;
      notify(ctx.state);
    },

    saveCode: async force => {
      await saveCode(ctx, env, force === true);
    },

    reloadCode: async () => {
      await reloadCode(ctx, env);
    },

    openStyles: async key => {
      inspector.tab = "styles";
      await openStyles(ctx, env, key);
    },

    selectStyle: key => {
      if (inspector.styles === undefined) return;
      inspector.styles.key = key;
      inspector.styles.error = undefined;
      notify(ctx.state);
    },

    stepStyle: (path, direction, big) => {
      stepStyle(ctx, env, path, direction, big);
    },

    readStyleKeys: async () => {
      try {
        const loaded = await loadStyleFile(env.files(), ctx.config.stylesFile);
        env.setStyleItems(isStyleEditError(loaded) ? [] : keysOf(loaded.file.blocks));
      } catch (error) {
        ctx.log.debug("flowView: style keys not read", { reason: String(error) });
        env.setStyleItems([]);
      }
    },

    fileOf: async id => {
      const { graph } = ctx.state.data;
      if (graph === undefined) return;
      const path = fileOfNode(await lookupOf(ctx, env), graph, id);
      if (path === undefined) return;
      try {
        const file = await env.files().read(path);
        return { path, line: lineOf(file.text, id.slice(id.indexOf("/") + 1)) };
      } catch {
        return { path, line: 1 };
      }
    },

    openInFiles: (path, line) => {
      env.openFile(path, line);
    },

    editorUrl: (path, line) => {
      const boot = env.boot();
      return boot === undefined ? undefined : editorUrlOf(boot.editorUrl, boot.root, path, line);
    },

    usedBy: async key => {
      try {
        return usedByOf(await env.read("game.ui"), key);
      } catch {
        return [];
      }
    }
  };
  return actions;
}
