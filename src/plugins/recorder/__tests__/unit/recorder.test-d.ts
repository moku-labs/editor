import { expectTypeOf } from "vitest";
import type { AgentEvents } from "../../../../config";
import { createAgentPlugin } from "../../../../config";
import type { Json } from "../../../registry/protocol";
import { recorderPlugin } from "../..";
import type {
  RecorderApi,
  RecorderCtx,
  RecorderSource,
  RecorderStatusEvent,
  RecordOrigin,
  ShareResult
} from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type level (checked by tsc, the file is not run): recorder:status is the
// recorder's per-plugin event, its payload is checked, share answers ShareResult.
// ─────────────────────────────────────────────────────────────────────────────

/** A listener that depends on the recorder (the bridge, the overlay) hooks its event, typed. */
export const bridgeLike = createAgentPlugin("bridgeLike", {
  depends: [recorderPlugin],
  hooks: () => ({
    "recorder:status": payload => {
      expectTypeOf(payload).toEqualTypeOf<RecorderStatusEvent>();
    }
  })
});

/** A plugin without that depends cannot hook it (bug: the event leaking into AgentEvents). */
export const stranger = createAgentPlugin("stranger", {
  // @ts-expect-error -- recorder:status reaches only plugins that depend on the recorder
  hooks: () => ({ "recorder:status": () => undefined })
});

expectTypeOf<"recorder:status" extends keyof AgentEvents ? true : false>().toEqualTypeOf<false>();

/**
 * The recorder's own emit refuses a payload without `pending`.
 *
 * @param emit - The recorder's emit.
 */
export function emitsWhole(emit: RecorderCtx["emit"]): void {
  // @ts-expect-error -- pending is missing
  emit("recorder:status", { state: "idle", lines: 0, bytes: 0, sent: 0 });
  emit("recorder:status", { state: "idle", lines: 0, bytes: 0, sent: 0, pending: 0 });
}

expectTypeOf<ReturnType<RecorderApi["share"]>>().toEqualTypeOf<Promise<ShareResult>>();

/**
 * Who starts a log is a closed union: the tools page's words exist for these six only.
 *
 * @param api - The recorder API.
 */
export function startsWithOrigin(api: RecorderApi): void {
  api.start({ by: "phone" });
  api.start({ label: "boss", by: "agent", name: "Claude" });
  // @ts-expect-error -- "someone" is not a RecordStarter (bug: a starter the tools page has no words for)
  api.start({ by: "someone" });
}

// The source value and the origin travel over the wire: both are Json (bug: a field toWireValue drops).
expectTypeOf<RecorderSource>().toExtend<Json>();
expectTypeOf<RecordOrigin>().toExtend<Json>();
