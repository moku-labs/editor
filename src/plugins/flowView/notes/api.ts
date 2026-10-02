/**
 * @file flowView notes module — the notes namespace of the api.
 */
import type { FlowCtx } from "../types";
import type { NotesApi } from "./types";

/**
 * Creates the notes api.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * await createNotesApi(ctx).create({ title: "First wood 4", from: { node: "board/merge", outcome: "done" } });
 * ```
 */
export function createNotesApi(_ctx: FlowCtx): NotesApi {
  throw new Error("not implemented");
}
