import { expectTypeOf } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsPlugin } from "../../../../config";
import { activeSourcePlugin } from "../..";
import type { ActiveSource, ConnectRequest, SourceChange } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type level (checked by tsc, the file is not run), spec 11 § 4: the two events
// are activeSource's per-plugin events, typed for a plugin that depends on it
// and out of reach for one that does not; a device source carries its device,
// a local one does not.
// ─────────────────────────────────────────────────────────────────────────────

/** A plugin that depends on activeSource (workspace, renderView) hooks both events, typed. */
export const renderLike = createToolsPlugin("renderLike", {
  depends: [activeSourcePlugin],
  hooks: () => ({
    "activeSource:changed": change => {
      expectTypeOf(change).toEqualTypeOf<SourceChange>();
      if (change.to.kind === "device") expectTypeOf(change.to.device.id).toEqualTypeOf<string>();
    },
    "activeSource:connect-requested": request => {
      expectTypeOf(request).toEqualTypeOf<ConnectRequest>();
    }
  })
});

/** A plugin without that depends cannot hook it (bug: the event leaking into ToolsEvents). */
export const stranger = createToolsPlugin("stranger", {
  // @ts-expect-error -- activeSource:changed reaches only plugins that depend on activeSource
  hooks: () => ({ "activeSource:changed": () => undefined })
});

expectTypeOf<
  "activeSource:changed" extends keyof ToolsEvents ? true : false
>().toEqualTypeOf<false>();

/**
 * Reads the device of a source: only a device source has one.
 *
 * @param source - The source.
 * @returns The device id, or undefined.
 */
export function deviceOf(source: ActiveSource): string | undefined {
  if (source.kind === "local") {
    // @ts-expect-error -- a local source has no device (bug: a local preview read as a phone)
    return source.device.id;
  }
  return source.kind === "device" ? source.device.id : undefined;
}
