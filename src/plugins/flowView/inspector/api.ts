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
import type { InspectorApi } from "./types";

/**
 * The node the Inspector shows: the selected node, else the current one.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The node id, or undefined.
 * @example
 * ```ts
 * shownNode(ctx, env); // "board/merge"
 * ```
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
 * @example
 * ```ts
 * await createInspectorApi(ctx, env).openCode("board/merge");
 * ```
 */
export function createInspectorApi(ctx: FlowCtx, env: FlowEnvironment): InspectorApi {
  const { inspector } = ctx.state;
  let request = 0;

  const actions: InspectorApi = {
    /**
     * Switches the tab; Code reads the shown node's file, Styles loads once.
     *
     * @param tab - The tab.
     * @example
     * ```ts
     * actions.inspector.setTab("code");
     * ```
     */
    setTab(tab) {
      inspector.tab = tab;
      notify(ctx.state);
      const node = shownNode(ctx, env);
      if (tab === "code" && node !== undefined) actions.openCode(node).catch(() => {});
      if (tab === "styles" && inspector.styles === undefined) actions.openStyles().catch(() => {});
    },

    /**
     * Reads a node's file into the Code tab.
     *
     * @param id - The node id.
     * @returns Resolves when shown.
     * @example
     * ```ts
     * await actions.inspector.openCode("board/merge");
     * ```
     */
    async openCode(id) {
      request += 1;
      const mine = request;
      await openCode(ctx, env, id, () => mine === request);
    },

    /**
     * Starts editing.
     *
     * @example
     * ```ts
     * actions.inspector.edit();
     * ```
     */
    edit() {
      const code = inspector.code;
      if (code === undefined) return;
      code.draft = code.text;
      code.discard = false;
      code.result = undefined;
      notify(ctx.state);
    },

    /**
     * Replaces the draft.
     *
     * @param text - The draft.
     * @example
     * ```ts
     * actions.inspector.setDraft(text);
     * ```
     */
    setDraft(text) {
      const code = inspector.code;
      if (code === undefined) return;
      code.draft = text;
      code.discard = false;
      notify(ctx.state);
    },

    /**
     * Esc in edit mode.
     *
     * @returns False when not editing.
     * @example
     * ```ts
     * actions.inspector.cancelEdit();
     * ```
     */
    cancelEdit() {
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

    /**
     * Drops the draft.
     *
     * @example
     * ```ts
     * actions.inspector.discard();
     * ```
     */
    discard() {
      const code = inspector.code;
      if (code === undefined) return;
      code.draft = undefined;
      code.discard = false;
      notify(ctx.state);
    },

    /**
     * Saves the draft.
     *
     * @param force - "Save anyway".
     * @returns Resolves when the result line is set.
     * @example
     * ```ts
     * await actions.inspector.saveCode();
     * ```
     */
    async saveCode(force) {
      await saveCode(ctx, env, force === true);
    },

    /**
     * Reads the file again ("Reload file").
     *
     * @returns Resolves when shown.
     * @example
     * ```ts
     * await actions.inspector.reloadCode();
     * ```
     */
    async reloadCode() {
      await reloadCode(ctx, env);
    },

    /**
     * Opens the Styles tab on a card.
     *
     * @param key - The text-style key.
     * @returns Resolves when loaded.
     * @example
     * ```ts
     * await actions.inspector.openStyles("ui.number");
     * ```
     */
    async openStyles(key) {
      inspector.tab = "styles";
      await openStyles(ctx, env, key);
    },

    /**
     * Selects a card.
     *
     * @param key - The text-style key.
     * @example
     * ```ts
     * actions.inspector.selectStyle("ui.plank");
     * ```
     */
    selectStyle(key) {
      if (inspector.styles === undefined) return;
      inspector.styles.key = key;
      inspector.styles.error = undefined;
      notify(ctx.state);
    },

    /**
     * One stepper press.
     *
     * @param path - The field path.
     * @param direction - 1 or -1.
     * @param big - Shift held.
     * @example
     * ```ts
     * actions.inspector.stepStyle("size", 1, false);
     * ```
     */
    stepStyle(path, direction, big) {
      stepStyle(ctx, env, path, direction, big);
    },

    /**
     * Reads the style keys for the palette.
     *
     * @returns Resolves when the palette group is replaced.
     * @example
     * ```ts
     * await actions.inspector.readStyleKeys();
     * ```
     */
    async readStyleKeys() {
      try {
        const loaded = await loadStyleFile(env.files(), ctx.config.stylesFile);
        env.setStyleItems(isStyleEditError(loaded) ? [] : keysOf(loaded.file.blocks));
      } catch (error) {
        ctx.log.debug("flowView: style keys not read", { reason: String(error) });
        env.setStyleItems([]);
      }
    },

    /**
     * The file and line of a node.
     *
     * @param id - The node id.
     * @returns Path and line, or undefined.
     * @example
     * ```ts
     * await actions.inspector.fileOf("board/merge"); // { path: "nodes/merge.ts", line: 3 }
     * ```
     */
    async fileOf(id) {
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

    /**
     * "Open in Files".
     *
     * @param path - The file.
     * @param line - The line.
     * @example
     * ```ts
     * actions.inspector.openInFiles("nodes/merge.ts", 3);
     * ```
     */
    openInFiles(path, line) {
      env.openFile(path, line);
    },

    /**
     * "Open in editor".
     *
     * @param path - The file.
     * @param line - The line.
     * @returns The link, or undefined without boot.
     * @example
     * ```ts
     * actions.inspector.editorUrl("nodes/merge.ts", 3);
     * ```
     */
    editorUrl(path, line) {
      const boot = env.boot();
      return boot === undefined ? undefined : editorUrlOf(boot.editorUrl, boot.root, path, line);
    },

    /**
     * UI nodes that use a text style.
     *
     * @param key - The text-style key.
     * @returns Names (empty until F-G1).
     * @example
     * ```ts
     * await actions.inspector.usedBy("ui.number"); // []
     * ```
     */
    async usedBy(key) {
      try {
        return usedByOf(await env.read("game.ui"), key);
      } catch {
        return [];
      }
    }
  };
  return actions;
}
