/**
 * @file renderView actions — Record, Stop and Mark (spec 09 § M7 Record): `editor.record { on, label
 * }` and `{ mark }` on the active source; the page sends no origin (the hub stamps it: the log reads
 * "started by you"); Stop toasts the saved path and size.
 */
import { linkPlugin } from "../../link";
import type { Json } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { markLabelOf, recordAnswerOf, recordRefusalOf, savedText } from "../derive/record";
import type { RecordAnswer, RenderViewCtx } from "../types";

/**
 * Runs Record or Stop; never rejects. Stop's answer toasts "Recording saved: .moku/perf/{file},
 * {mb} MB".
 *
 * @param ctx - Domain context of renderView.
 * @param on - Record or Stop.
 * @param label - The log's label (Record only).
 * @returns The answer.
 * @example
 * ```ts
 * await runRecord(ctx, true, undefined); // { ok: true, text: "Recording", file: "perf-20261016-1412-sm-a266b.jsonl" }
 * ```
 */
export async function runRecord(
  ctx: RenderViewCtx,
  on: boolean,
  label: string | undefined
): Promise<RecordAnswer> {
  const input: Record<string, Json> = { on };
  const typed = label?.trim() ?? "";
  if (on && typed !== "") input.label = typed;
  const bytes = ctx.state.mission.recorder?.bytes ?? 0;
  let answer: RecordAnswer;
  try {
    const result = await ctx.require(linkPlugin).run("editor.record", input);
    answer = recordAnswerOf(on, result.value);
  } catch (error) {
    return recordRefusalOf(error);
  }
  if (!on && answer.ok && answer.file !== null) {
    ctx.require(workspacePlugin).toast(savedText(answer.file, bytes));
  }
  return answer;
}

/**
 * Runs a mark; an empty label becomes "mark {n + 1}".
 *
 * @param ctx - Domain context of renderView.
 * @param label - The mark's label.
 * @returns The answer's `marked`; false when nothing records or the run was refused.
 * @example
 * ```ts
 * await runMark(ctx, ""); // true: "mark 3" added
 * ```
 */
export async function runMark(ctx: RenderViewCtx, label: string | undefined): Promise<boolean> {
  const mark = markLabelOf(label, ctx.state.mission.recorder?.marks ?? []);
  try {
    const { value } = await ctx.require(linkPlugin).run("editor.record", { mark });
    return (
      typeof value === "object" && value !== null && !Array.isArray(value) && value.marked === true
    );
  } catch {
    return false;
  }
}
