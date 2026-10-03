/**
 * @file flowView inspector module — the Code tab controller: read a node's file, edit, save with
 * the version, then the D-07 reload/restore flow; conflicts offer "Reload file" / "Save anyway".
 * Wire errors are shown without the `[moku-editor]` prefix (R7).
 */
import { bareMessage, errorCode, isWireError } from "../../registry/protocol";
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment, NodeId } from "../types";
import { fileOfNode, lineOf, loadSourceLookup, noFileText, SOURCE_LOADS } from "./files";
import type { SourceLookup } from "./types";

/**
 * The result line of a conflicting save.
 */
export const CHANGED_ON_DISK = "! The file changed on disk";

/**
 * The session lookup of the node → file rule, built on first need.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The lookup.
 * @example
 * ```ts
 * const lookup = await lookupOf(ctx, env);
 * ```
 */
export async function lookupOf(ctx: FlowCtx, env: FlowEnvironment): Promise<SourceLookup> {
  ctx.state.inspector.sources ??= await loadSourceLookup(env.files(), ctx.log);
  return ctx.state.inspector.sources;
}

/**
 * Reads a node's file into the Code tab ("Source loads from the dev server." while pending).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param id - The node id.
 * @param isCurrent - False once a newer request started (its result is dropped).
 * @returns Resolves when the tab shows the file or a placeholder.
 * @example
 * ```ts
 * await openCode(ctx, env, "board/merge", () => true);
 * ```
 */
export async function openCode(
  ctx: FlowCtx,
  env: FlowEnvironment,
  id: NodeId,
  isCurrent: () => boolean
): Promise<void> {
  const { inspector } = ctx.state;
  const { graph } = ctx.state.data;
  if (graph === undefined) return;
  inspector.code = undefined;
  inspector.codeNote = SOURCE_LOADS;
  notify(ctx.state);

  try {
    const lookup = await lookupOf(ctx, env);
    const path = fileOfNode(lookup, graph, id);
    if (path === undefined) {
      if (isCurrent()) inspector.codeNote = noFileText(lookup, graph, id);
      return;
    }
    const file = await env.files().read(path);
    if (!isCurrent()) return;
    inspector.code = {
      path,
      text: file.text,
      version: file.version,
      line: lineOf(file.text, id.slice(id.indexOf("/") + 1)),
      draft: undefined,
      result: undefined,
      conflict: false,
      discard: false
    };
    inspector.codeNote = undefined;
  } catch (error) {
    ctx.log.warn("flowView: source not read", { id, message: String(error) });
    if (isCurrent()) inspector.codeNote = SOURCE_LOADS;
  } finally {
    notify(ctx.state);
  }
}

/**
 * Saves the draft: "✓ No changes" without a write for an identical text; else write with the
 * version, toast, reload the game with restore (D-07) and show the result line.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param force - "Save anyway": re-read the version first.
 * @returns Resolves when the result line is set.
 * @example
 * ```ts
 * await saveCode(ctx, env, false);
 * ```
 */
export async function saveCode(ctx: FlowCtx, env: FlowEnvironment, force: boolean): Promise<void> {
  const code = ctx.state.inspector.code;
  if (code?.draft === undefined) return;
  const draft = code.draft;
  if (!force && draft === code.text) {
    code.draft = undefined;
    code.result = { ok: true, text: "✓ No changes" };
    notify(ctx.state);
    return;
  }

  const files = env.files();
  try {
    const fresh = force ? await files.read(code.path) : undefined;
    const version = fresh?.version ?? code.version;
    const written = await files.write(code.path, draft, version);
    Object.assign(code, {
      text: draft,
      version: written.version,
      draft: undefined,
      conflict: false,
      discard: false
    });
    code.result = { ok: true, text: "Saved · reloading the game…" };
    env.toast("Saved", code.path);
    notify(ctx.state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const conflict = isWireError(error) && error.code === errorCode.versionConflict;
    if (!conflict) ctx.log.warn("flowView: save failed", { path: code.path, message });
    code.conflict = conflict;
    code.result = { ok: false, text: conflict ? CHANGED_ON_DISK : `! ${bareMessage(message)}` };
    notify(ctx.state);
    return;
  }

  const reload = await env.reload();
  if (reload.restored) {
    code.result = {
      ok: true,
      text: "✓ Saved · game reloaded · state restored from the last checkpoint"
    };
  } else {
    const reason = reload.reason ?? "unknown";
    ctx.log.warn("flowView: the game state was not restored after a save", { reason });
    code.result = { ok: false, text: `! Saved · game reloaded, state not restored (${reason})` };
  }
  notify(ctx.state);
}

/**
 * Reads the file again and drops the draft ("Reload file").
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns Resolves when the tab shows the fresh text.
 * @example
 * ```ts
 * await reloadCode(ctx, env);
 * ```
 */
export async function reloadCode(ctx: FlowCtx, env: FlowEnvironment): Promise<void> {
  const code = ctx.state.inspector.code;
  if (code === undefined) return;
  const file = await env.files().read(code.path);
  Object.assign(code, {
    text: file.text,
    version: file.version,
    draft: undefined,
    result: undefined,
    conflict: false,
    discard: false
  });
  notify(ctx.state);
}
