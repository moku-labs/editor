import { describe, expectTypeOf, it } from "vitest";
import type { RunState } from "../../../registry/protocol";
import type { CommandEntry } from "../../../registry/types";
import { registerCaptureCommands } from "../../commands";
import type { CaptureRegistry, Config, Device, SeriesShot, SeriesValue, Shot } from "../../types";
import { createDeps, fakeClock } from "../helpers";

/**
 * A registry lookup that finds nothing.
 *
 * @param _id - The id.
 * @returns Always undefined.
 */
const command = (_id: string): CommandEntry | undefined => undefined;

/**
 * A registry add that keeps nothing.
 *
 * @param _entry - The entry.
 */
const add = (_entry: CommandEntry): void => undefined;

/**
 * A fixed envelope.
 *
 * @returns The state at home.
 */
const envelope = (): RunState => ({ path: "home", frame: 0, tainted: false });

describe("capture types", () => {
  it("tags every series shot with its image, frame and time", () => {
    expectTypeOf<SeriesValue["shots"][number]>().toEqualTypeOf<SeriesShot>();
    expectTypeOf<SeriesShot>().toEqualTypeOf<{
      readonly image: string;
      readonly frame: number;
      readonly atMs: number;
    }>();
  });

  it("carries the device on a series and on a shot", () => {
    expectTypeOf<SeriesValue["device"]>().toEqualTypeOf<Device>();
    expectTypeOf<Shot>().toEqualTypeOf<{
      readonly image: string;
      readonly frame: number;
      readonly device: Device;
    }>();
    expectTypeOf<Device["orientation"]>().toEqualTypeOf<"portrait" | "landscape">();
  });

  it("requires both limits in the config", () => {
    expectTypeOf<Config>().toEqualTypeOf<{ maxDurationMs: number; minIntervalMs: number }>();
    // @ts-expect-error — minIntervalMs is required
    const config: Config = { maxDurationMs: 20_000 };
    expectTypeOf(config).toEqualTypeOf<Config>();
  });

  it("rejects a registry without add or envelope", () => {
    const deps = createDeps(fakeClock());

    expectTypeOf(registerCaptureCommands).parameter(0).toEqualTypeOf<CaptureRegistry>();
    // @ts-expect-error — the registry needs add
    expectTypeOf(registerCaptureCommands).toBeCallableWith({ command, envelope }, deps);
    // @ts-expect-error — the registry needs envelope
    expectTypeOf(registerCaptureCommands).toBeCallableWith({ command, add }, deps);
    expectTypeOf(registerCaptureCommands).toBeCallableWith({ command, add, envelope }, deps);
  });
});
