import { expectTypeOf } from "vitest";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { perfPlugin } from "../../../perf";
import type { PerfWindowView } from "../../../perf/protocol";
import type { PerfApi } from "../../../perf/types";
import { recorderPlugin } from "../../../recorder";
import type { RecorderStatusEvent } from "../../../recorder/types";
import { registryPlugin } from "../../../registry";
import { overlayPlugin } from "../..";
import type { OverlayApi, OverlayPluginCtx, OverlayState } from "../../types";

// Type-level checks of the overlay (checked by tsc; vitest runs no file of this name).

declare const ctx: OverlayPluginCtx;
declare const api: OverlayApi;

ctx.emit("overlay:changed", { mode: "pill", tab: "frames" });
// @ts-expect-error — "open" is not a mode
ctx.emit("overlay:changed", { mode: "open", tab: "frames" });
// @ts-expect-error — the address is text
ctx.emit("overlay:connect", { address: 1 });

// @ts-expect-error — hidden is close(), not open()
api.open({ mode: "hidden" });
expectTypeOf(api.commands()[0]?.kind).toEqualTypeOf<"toggle" | "button" | undefined>();

expectTypeOf<OverlayState["rec"]>().toEqualTypeOf<RecorderStatusEvent | undefined>();

const visit: Parameters<PerfApi["readWindow"]>[0] = window => {
  expectTypeOf(window).toEqualTypeOf<PerfWindowView>();
  // @ts-expect-error — the window's columns are read-only inside the visitor
  window.ms[0] = 0;
};
expectTypeOf(visit).toBeFunction();

const framework = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin, overlayPlugin]
});
const app = framework.createApp({ pluginConfigs: { overlay: { mode: "pill", dock: "left" } } });
expectTypeOf(app.overlay).toEqualTypeOf<OverlayApi>();
// @ts-expect-error — corner was replaced by dock
framework.createApp({ pluginConfigs: { overlay: { corner: "top-left" } } });
