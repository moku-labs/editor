/* eslint-disable unicorn/no-null -- null is "not read" in the parsers' answers */
/**
 * @file collector plugin — the pure adb parsers, ported from the game's `tools/perf/device.ts`
 * (behaviour and examples kept): ready devices, the model, the battery temperature, the thermal
 * status and sensors, the app package, the gfxinfo totals and the frames between two readings.
 * Every command they read is a read: nothing on the phone changes.
 */
import { normalizeModel } from "../../hub/protocol";
import { gfxPercentile } from "../report";
import type { GfxSpan, GfxTotals } from "../types";

export { gfxPercentile } from "../report";

/** The marker of a Wi-Fi phone's second entry in `adb devices`: the same phone again. */
const TLS_TWIN = "_adb-tls";

/** The key of the battery temperature line of `dumpsys battery`. */
const BATTERY_KEY = "temperature:";

/** A battery temperature in tenths of a degree. */
const TENTHS = /^-?\d+$/;

/** A whole number of the histogram line. */
const DIGITS = /^\d+$/;

/** The key of the histogram line of `dumpsys gfxinfo`. */
const HISTOGRAM_KEY = "HISTOGRAM:";

/** One sensor reading of `dumpsys thermalservice`. */
const SENSOR_READING = /Temperature\{mValue=(-?[\d.]+),[^}]*mName=([^,}]+)/g;

/**
 * The serials of the ready devices of `adb devices`: the lines after the first, state `device`
 * only, without the `_adb-tls` twin of a Wi-Fi phone.
 *
 * @param text - What `adb devices` printed.
 * @returns The serials.
 * @example
 * ```ts
 * parseDevices("List of devices attached\nR5CX30ABCDE\tdevice\nemulator-5554\tunauthorized\n"); // ["R5CX30ABCDE"]
 * ```
 */
export function parseDevices(text: string): string[] {
  const serials: string[] = [];
  for (const line of text.split("\n").slice(1)) {
    const [serial = "", state] = line.trim().split(/\s+/);
    if (state === "device" && !serial.includes(TLS_TWIN)) serials.push(serial);
  }

  return serials;
}

/**
 * The model of `getprop ro.product.model`, normalized like the page's header (spec 01 C8).
 *
 * @param text - What getprop printed.
 * @returns The model, or null for an empty answer.
 * @example
 * ```ts
 * parseModel("SM-A266B\n"); // "SM-A266B"
 * ```
 */
export function parseModel(text: string): string | null {
  return normalizeModel(text);
}

/**
 * The battery temperature of `dumpsys battery`: its own line, in tenths of a degree. Samsung's
 * history values inside longer lines are not read.
 *
 * @param text - What `dumpsys battery` printed.
 * @returns °C, or null when the text has none.
 * @example
 * ```ts
 * parseBattery("  level: 48\n  temperature: 351\n"); // 35.1
 * ```
 */
export function parseBattery(text: string): number | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(BATTERY_KEY)) continue;

    const tenths = trimmed.slice(BATTERY_KEY.length).trim();
    if (TENTHS.test(tenths)) return Number(tenths) / 10;
  }

  return null;
}

/**
 * The thermal status and the sensors of `dumpsys thermalservice`: the HAL's current readings, the
 * cached block only when the HAL block has none; a sensor reading 0 is not fitted and left out.
 *
 * @param text - What `dumpsys thermalservice` printed.
 * @returns The status (null unknown) and the sensors by name.
 * @example
 * ```ts
 * parseThermal("Thermal Status: 1\nCurrent temperatures from HAL:\n\tTemperature{mValue=38.4, mType=3, mName=SKIN, mStatus=1}\n"); // { status: 1, sensors: { SKIN: 38.4 } }
 * ```
 */
export function parseThermal(text: string): {
  status: number | null;
  sensors: Record<string, number>;
} {
  const status = /^Thermal Status:\s*(\d+)/m.exec(text)?.[1];
  const current = text.split("Current temperatures from HAL:")[1]?.split(/^\S/m)[0] ?? "";
  const cached = text.split("Cached temperatures:")[1]?.split(/^\S/m)[0] ?? "";
  const block = current.includes("Temperature{") ? current : cached;

  const sensors: Record<string, number> = {};
  for (const [, value, name] of block.matchAll(SENSOR_READING)) {
    if (name !== undefined && Number(value) !== 0) sensors[name] = Number(value);
  }

  return { status: status === undefined ? null : Number(status), sensors };
}

/**
 * The game's package on a phone (`pm list packages <appId>`): `<appId>.debug` when listed (the
 * debug build installs beside the store build), else `<appId>`, else null.
 *
 * @param text - What pm printed.
 * @param appId - The game's base identifier.
 * @returns The package, or null.
 * @example
 * ```ts
 * parsePackages("package:com.example.garden\npackage:com.example.garden.debug\n", "com.example.garden"); // "com.example.garden.debug"
 * ```
 */
export function parsePackages(text: string, appId: string): string | null {
  const listed = new Set(
    text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("package:"))
      .map(line => line.slice("package:".length))
  );
  const debug = `${appId}.debug`;
  if (listed.has(debug)) return debug;

  return listed.has(appId) ? appId : null;
}

/**
 * The totals of `dumpsys gfxinfo <package>`.
 *
 * @param text - What gfxinfo printed.
 * @returns The totals, or undefined when a part is missing (the app does not run).
 * @example
 * ```ts
 * parseGfx("Total frames rendered: 45230\nJanky frames: 10663 (23.57%)\nHISTOGRAM: 5ms=4171 6ms=807\n")?.frames; // 45230
 * ```
 */
export function parseGfx(text: string): GfxTotals | undefined {
  const frames = /^Total frames rendered:\s*(\d+)/m.exec(text)?.[1];
  const janky = /^Janky frames:\s*(\d+)/m.exec(text)?.[1];
  const buckets = text
    .split("\n")
    .find(line => line.startsWith(HISTOGRAM_KEY))
    ?.slice(HISTOGRAM_KEY.length);
  if (frames === undefined || janky === undefined || buckets === undefined) return undefined;

  const histogram = new Map<number, number>();
  for (const bucket of buckets.split(" ")) {
    const [ms = "", count = ""] = bucket.split("ms=");
    if (DIGITS.test(ms) && DIGITS.test(count)) histogram.set(Number(ms), Number(count));
  }

  return { frames: Number(frames), janky: Number(janky), histogram };
}

/**
 * The frames of a stretch from two gfxinfo readings. An app restarted in between
 * (`after.frames < before.frames`) counts from zero: its newer totals are the stretch.
 *
 * @param before - The totals at the start.
 * @param after - The totals at the end.
 * @param seconds - How long the stretch was.
 * @returns The frames of the stretch, fps with one decimal.
 * @example
 * ```ts
 * spanOf({ frames: 0, janky: 0, histogram: new Map() }, { frames: 412, janky: 96, histogram: new Map([[16, 412]]) }, 10).fps; // 41.2
 * ```
 */
export function spanOf(before: GfxTotals, after: GfxTotals, seconds: number): GfxSpan {
  const restarted = after.frames < before.frames;
  const hist: [number, number][] = [];
  for (const [ms, count] of after.histogram) {
    const added = count - (restarted ? 0 : (before.histogram.get(ms) ?? 0));
    if (added > 0) hist.push([ms, added]);
  }
  const frames = after.frames - (restarted ? 0 : before.frames);

  return {
    frames,
    janky: after.janky - (restarted ? 0 : before.janky),
    fps: seconds > 0 ? Math.round((frames / seconds) * 10) / 10 : 0,
    p50: gfxPercentile(hist, 0.5),
    p90: gfxPercentile(hist, 0.9),
    p99: gfxPercentile(hist, 0.99),
    hist
  };
}
