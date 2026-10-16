/**
 * @file pages plugin — the hooks: the collector's per-plugin `collector:session` (visible because
 * pages depends on the collector) becomes the live lines of the perf command, only after
 * `attachPerf`. Every other app prints nothing.
 */
import { relative } from "node:path/posix";
import type { CollectorSessionEvent } from "../collector/types";
import { filesPlugin } from "../files";
import { isStaleLine, newLiveMemory, perfLiveLines } from "./perf/live";
import type { PagesCtx, PagesHooks } from "./types";

/**
 * Prints the live lines of one log event through the attached output: the STALE line as a
 * warning, every other line plain. The file prints relative to the root; the computer's engine
 * is `files.engine().id`.
 *
 * @param ctx - Domain context of pages.
 * @param event - The collector's event.
 */
function printLiveLines(ctx: PagesCtx, event: CollectorSessionEvent): void {
  const { perf } = ctx.state;
  if (perf === undefined) return;

  const files = ctx.require(filesPlugin);
  const memory = perf.seen.get(event.file) ?? newLiveMemory();
  perf.seen.set(event.file, memory);

  const shown = { ...event, file: relative(files.root(), event.file) };
  for (const line of perfLiveLines(shown, memory, Date.now(), files.engine().id)) {
    if (isStaleLine(line)) perf.output.warn(line);
    else perf.output.line(line);
  }
}

/**
 * pages' hooks factory (`hooks: createPagesHooks`).
 *
 * @param ctx - Domain context of pages.
 * @returns The hooks.
 */
export function createPagesHooks(ctx: PagesCtx): PagesHooks {
  return {
    "collector:session": event => {
      printLiveLines(ctx, event);
    }
  };
}
