/**
 * @file flowView inspector module — the Code tab controller: read a node's file at the place the
 * project index gives, follow it when an agent edits or moves it, edit, save with the version, then
 * the D-07 reload/restore flow; conflicts offer "Reload file" / "Save anyway". Wire errors are
 * shown without the `[moku-editor]` prefix (R7).
 */
import type { FreshFound } from "../../panels/shared/project";
import { findFresh } from "../../panels/shared/project";
import { bareMessage, isVersionConflict } from "../../registry/protocol";
import type { ReloadResult } from "../../workspace/types";
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment, NodeId } from "../types";
import { missingCodeText, nodeKey, SOURCE_LOADS } from "./files";
import type { CodeState } from "./types";

/**
 * The result line of a conflicting save.
 */
export const CHANGED_ON_DISK = "! The file changed on disk";

/**
 * A fresh Code tab slice from an index answer and the read after it.
 *
 * @param fresh - The answer with the text and version of its file.
 * @returns The slice, not editing.
 * @example
 * ```ts
 * codeOf({ found: { path: "nodes/merge.ts", line: 17, range: [17, 1, 30, 3], hash: "a1" }, text, version: "a1" });
 * // { path: "nodes/merge.ts", line: 17, version: "a1", draft: undefined, … }
 * ```
 */
function codeOf(fresh: FreshFound): CodeState {
  return {
    path: fresh.found.path,
    text: fresh.text,
    version: fresh.version,
    line: fresh.found.line,
    draft: undefined,
    result: undefined,
    conflict: false,
    discard: false
  };
}

/**
 * Shows a node's code from the project index without blanking the tab first: the same file at the
 * same version keeps the tab (its result line too) and moves only the line; another file or version
 * replaces it; no answer shows why. A draft typed meanwhile is never replaced.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param id - The node id.
 * @param isCurrent - False once a newer request started (its result is dropped).
 * @returns Resolves when the tab shows the file or a placeholder.
 */
export async function showCode(
  ctx: FlowCtx,
  env: FlowEnvironment,
  id: NodeId,
  isCurrent: () => boolean
): Promise<void> {
  const { inspector } = ctx.state;
  const fresh = await findFresh(env.files(), nodeKey(id));
  const held = inspector.code;
  if (!isCurrent() || held?.draft !== undefined) return;

  // No answer: the index is off, does not know the node, or its file could not be read.
  if (fresh === undefined) {
    const note = missingCodeText(env.project(), id);
    if (note === SOURCE_LOADS) ctx.log.warn("flowView: source not read", { id });
    inspector.code = undefined;
    inspector.codeNote = note;
    notify(ctx.state);
    return;
  }

  // The file as the tab has it: only the line may have moved.
  if (held?.path === fresh.found.path && held.version === fresh.version) {
    held.line = fresh.found.line;
  } else {
    inspector.code = codeOf(fresh);
  }
  inspector.codeNote = undefined;
  notify(ctx.state);
}

/**
 * Reads a node's file into the Code tab ("Source loads from the dev server." while pending).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param id - The node id.
 * @param isCurrent - False once a newer request started (its result is dropped).
 * @returns Resolves when the tab shows the file or a placeholder.
 */
export async function openCode(
  ctx: FlowCtx,
  env: FlowEnvironment,
  id: NodeId,
  isCurrent: () => boolean
): Promise<void> {
  const { inspector } = ctx.state;
  if (ctx.state.data.graph === undefined) return;
  inspector.codeNode = id;
  inspector.code = undefined;
  inspector.codeNote = SOURCE_LOADS;
  notify(ctx.state);

  await showCode(ctx, env, id, isCurrent);
}

/**
 * The save in flight per Code tab. A ⌘S during it waits for it, then saves the newer draft, so
 * it neither writes with the old version (a false conflict) nor is lost.
 */
const savesInFlight = new WeakMap<CodeState, Promise<void>>();

/**
 * Saves the draft: "✓ No changes" without a write for an identical text; else write with the
 * version, toast, reload the game with restore (D-07) and show the result line. A save asked
 * while one is in flight runs after it.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param force - "Save anyway": re-read the version first.
 * @returns Resolves when the result line is set.
 */
export function saveCode(ctx: FlowCtx, env: FlowEnvironment, force: boolean): Promise<void> {
  // No Code tab open: nothing to save.
  const code = ctx.state.inspector.code;
  if (code === undefined) return Promise.resolve();

  // A save in flight: this one runs after it, with the version that save wrote.
  const running = savesInFlight.get(code);
  if (running !== undefined) return running.then(() => saveCode(ctx, env, force));

  // The first save: kept until it settles, so a ⌘S during it waits for it.
  const run = writeCode(ctx, env, code, force).finally(() => {
    if (savesInFlight.get(code) === run) savesInFlight.delete(code);
  });
  savesInFlight.set(code, run);
  return run;
}

/**
 * One save of the Code tab draft (see `saveCode`). Text typed while the write is in flight stays
 * the draft: the editor keeps it open with the newer text.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param code - The Code tab state.
 * @param force - "Save anyway": re-read the version first.
 * @returns Resolves when the result line is set.
 */
async function writeCode(
  ctx: FlowCtx,
  env: FlowEnvironment,
  code: CodeState,
  force: boolean
): Promise<void> {
  if (code.draft === undefined) return;
  const draft = code.draft;

  // The same text again: nothing to write, nothing to reload.
  if (!force && draft === code.text) {
    code.draft = undefined;
    code.result = { ok: true, text: "✓ No changes" };
    notify(ctx.state);
    return;
  }

  // Write with the version read (a fresh one for "Save anyway"); the moment before the write is
  // where the reload starts to look for the game's hot swap.
  const files = env.files();
  const savedAt = Date.now();
  try {
    const fresh = force ? await files.read(code.path) : undefined;
    const version = fresh?.version ?? code.version;
    const written = await files.write(code.path, draft, version);
    const typedSince = code.draft !== draft;
    Object.assign(code, {
      text: draft,
      version: written.version,
      draft: typedSince ? code.draft : undefined,
      conflict: false,
      discard: false
    });
    code.result = { ok: true, text: "Saved · reloading the game…" };
    env.toast("Saved", code.path);
    notify(ctx.state);
  } catch (error) {
    // A file changed on disk offers "Reload file" / "Save anyway"; any other failure is warned.
    const message = error instanceof Error ? error.message : String(error);
    const conflict = isVersionConflict(error);
    if (!conflict) ctx.log.warn("flowView: save failed", { path: code.path, message });
    code.conflict = conflict;
    code.result = { ok: false, text: conflict ? CHANGED_ON_DISK : `! ${bareMessage(message)}` };
    notify(ctx.state);
    return;
  }

  // Written: the game reloads (or swaps the module in place) and the result line says which.
  code.result = savedResult(ctx, await env.reload(savedAt));
  notify(ctx.state);
}

/**
 * The result line after a save, from the reload that followed it. A state that was not restored
 * is warned; a hot swap (U10) reloaded nothing, so there is nothing to restore.
 *
 * @param ctx - Domain context of flowView.
 * @param reload - The reload's result.
 * @returns The result line.
 */
function savedResult(ctx: FlowCtx, reload: ReloadResult): NonNullable<CodeState["result"]> {
  if (reload.reason === "hot_swap") return { ok: true, text: "✓ Saved · game updated" };
  if (reload.restored) {
    return { ok: true, text: "✓ Saved · game reloaded · state restored from the last checkpoint" };
  }
  const reason = reload.reason ?? "unknown";
  ctx.log.warn("flowView: the game state was not restored after a save", { reason });
  return { ok: false, text: `! Saved · game reloaded, state not restored (${reason})` };
}

/**
 * Reads the file again and drops the draft ("Reload file").
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns Resolves when the tab shows the fresh text.
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
