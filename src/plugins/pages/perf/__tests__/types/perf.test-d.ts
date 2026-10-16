import type { BrandConsole } from "@moku-labs/common/cli";
import { describe, expectTypeOf, it } from "vitest";
import { createServerPlugin } from "../../../../../config";
import type { CollectorSessionEvent } from "../../../../collector/types";
import { filesPlugin } from "../../../../files";
import { hubPlugin } from "../../../../hub";
import { createPagesHooks } from "../../../handlers";
import type { BinArgs, PagesApi, PagesHooks } from "../../../types";
import type { PerfArgs, PerfDeps } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level checks of the perf CLI surface (checked by tsc; vitest does not
// run *.test-d.ts files).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The perf branch of a parsed argv.
 *
 * @param args - Parsed bin arguments.
 * @returns The perf arguments, or undefined.
 */
function perfOf(args: BinArgs): PerfArgs | undefined {
  if (args.kind !== "perf") return undefined;
  expectTypeOf(args).toEqualTypeOf<PerfArgs>();
  return args;
}

describe("perf CLI types", () => {
  it("narrows BinArgs to PerfArgs on kind perf", () => {
    expectTypeOf(perfOf).returns.toEqualTypeOf<PerfArgs | undefined>();
  });

  it("lets attachPerf take the bin's brand console", () => {
    expectTypeOf<BrandConsole>().toMatchTypeOf<Parameters<PagesApi["attachPerf"]>[0]>();
  });

  it("types extraConfig as the server createApp's pluginConfigs", () => {
    const missingAdb: PerfDeps["extraConfig"] = { collector: { adb: "/no/adb" } };
    // @ts-expect-error — the adb command is a string
    const numericAdb: PerfDeps["extraConfig"] = { collector: { adb: 1 } };
    // @ts-expect-error — no server plugin is called nope
    const unknownPlugin: PerfDeps["extraConfig"] = { nope: {} };
    expectTypeOf([missingAdb, numericAdb, unknownPlugin]).not.toBeAny();
  });

  it("hooks collector:session typed CollectorSessionEvent", () => {
    expectTypeOf<
      Parameters<PagesHooks["collector:session"]>[0]
    >().toEqualTypeOf<CollectorSessionEvent>();
  });

  it("needs collectorPlugin in depends for its hook (bug: the edge dropped from pages)", () => {
    const blind = createServerPlugin("blindPages", {
      depends: [filesPlugin, hubPlugin],
      // @ts-expect-error — collector:session is visible through depends on the collector only
      hooks: createPagesHooks
    });
    expectTypeOf(blind.name).toEqualTypeOf<"blindPages">();
  });
});
