/**
 * @file renderView device strip — pure derivations (spec 09 § Derivation rules): the strip view
 * the api hands out, and the texts of the device row, the headline and More. renderView computes
 * nothing about frames: perf computes, the painter paints, this file formats.
 */
import type { LinkStatus } from "../../registry/protocol";
import type { PerfRate, PerfSecond, PerfWindowView } from "./contract";
import { meanGpu } from "./contract";
import { spikeCounter } from "./step";
import type {
  DeviceStripState,
  DeviceStripView,
  LinkCell,
  RecCell,
  RunTone,
  StripLine,
  StripRun
} from "./types";

/**
 * The text of a value the engine did not report.
 */
export const DASH = "—";

/**
 * The thousands separator of counts ("1 384").
 */
const THIN_SPACE = " ";

/**
 * Whole numbers with a group separator, replaced by the thin space.
 */
const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * The separator of the More items.
 */
const ITEM_SEPARATOR = " · ";

/**
 * Milliseconds in a second.
 */
const MS_PER_SECOND = 1000;

/**
 * Seconds in a minute.
 */
const SECONDS_PER_MINUTE = 60;

/**
 * The window length the headline names before the first window, seconds.
 */
const DEFAULT_WINDOW_SECONDS = 6;

/**
 * More, closed: the names of what it holds.
 */
const MORE_CLOSED = "systems, filters, kept, redraws, views, heap, insets, backend, canvas, device";

/**
 * A plain run.
 *
 * @param text - The text.
 * @returns The run.
 * @example
 * ```ts
 * plain(" spikes"); // { text: " spikes", tone: "plain" }
 * ```
 */
function plain(text: string): StripRun {
  return { text, tone: "plain" };
}

/**
 * A value run: cyan, or amber when it warns.
 *
 * @param text - The value text.
 * @param warn - Whether it is a caution.
 * @returns The run.
 * @example
 * ```ts
 * value("18.2", true); // { text: "18.2", tone: "warn" }
 * ```
 */
function value(text: string, warn = false): StripRun {
  const tone: RunTone = warn ? "warn" : "value";
  return { text, tone };
}

/**
 * A count, whole, with a thin space between thousands.
 *
 * @param count - The number.
 * @returns The text.
 * @example
 * ```ts
 * whole(1384.2); // "1 384" (thin space)
 * ```
 */
export function whole(count: number): string {
  return WHOLE.format(Math.round(count)).replaceAll(",", THIN_SPACE);
}

/**
 * A count or the dash.
 *
 * @param count - The number, null or undefined when unknown.
 * @returns The text.
 * @example
 * ```ts
 * wholeOrDash(null); // "—"
 * ```
 */
function wholeOrDash(count: number | null | undefined): string {
  return count === null || count === undefined ? DASH : whole(count);
}

/**
 * True when both fingerprints are known and differ: the phone runs another engine than the
 * computer.
 *
 * @param device - The phone's engine id.
 * @param computer - The computer's engine id.
 * @returns Whether the phone's build is stale.
 * @example
 * ```ts
 * isStale("0.14.12+9c41e0", "0.14.13+1ab7f2"); // true
 * isStale("0.14.12+9c41e0", undefined); // false
 * ```
 */
export function isStale(device: string | undefined, computer: string | undefined): boolean {
  return device !== undefined && computer !== undefined && device !== computer;
}

/**
 * The profile a build id names: `debug-full-…` (checked first), `debug-…`, or `dev`.
 *
 * @param id - The build id; null or undefined when unknown.
 * @returns The profile; undefined when the id names none.
 * @example
 * ```ts
 * buildProfile("debug-full-20261014T160000Z"); // "debug, full"
 * buildProfile("debug-20261014T160000Z"); // "debug, read-only"
 * ```
 */
export function buildProfile(id: string | null | undefined): DeviceStripView["build"]["profile"] {
  if (id === null || id === undefined) return undefined;
  if (id.startsWith("debug-full-")) return "debug, full";
  if (id.startsWith("debug-")) return "debug, read-only";
  return id === "dev" ? "dev" : undefined;
}

/**
 * The operating system of a user agent: "Android 15" or "iOS 18".
 *
 * @param userAgent - The user agent.
 * @returns The system, undefined when neither.
 * @example
 * ```ts
 * osOf("Mozilla/5.0 (Linux; Android 15; SM-A266B) …"); // "Android 15"
 * ```
 */
function osOf(userAgent: string | undefined): string | undefined {
  if (userAgent === undefined) return undefined;
  const android = /Android (\d+)/.exec(userAgent)?.[1];
  if (android !== undefined) return `Android ${android}`;
  const ios = /OS (\d+)_/.exec(userAgent)?.[1];
  return ios === undefined ? undefined : `iOS ${ios}`;
}

/**
 * A device pixel ratio as text: up to two decimals.
 *
 * @param dpr - The ratio.
 * @returns The text.
 * @example
 * ```ts
 * dprText(2.8125); // "2.81"
 * ```
 */
function dprText(dpr: number): string {
  return String(Math.round(dpr * 100) / 100);
}

/**
 * The display facts of the device line: Hz from the sample's ticks and the dpr.
 *
 * @param second - The last perf value.
 * @returns The known parts, e.g. ["60 Hz", "dpr 2.81"].
 */
function displayParts(second: PerfSecond | undefined): string[] {
  const parts: string[] = [];
  const hz = second?.sample?.ticks;
  const dpr = second?.display?.dpr;
  if (hz !== undefined) parts.push(`${hz} Hz`);
  if (dpr !== undefined) parts.push(`dpr ${dprText(dpr)}`);
  return parts;
}

/**
 * The about line under the model: OS, WebView, Hz and dpr, the known parts only.
 *
 * @param second - The last perf value.
 * @returns E.g. "Android 15, WebView 131, 60 Hz, dpr 2.81"; "" when nothing is known.
 */
export function aboutLine(second: PerfSecond | undefined): string {
  const os = osOf(second?.device?.userAgent);
  const webview = second?.device?.webview;
  const parts = [os, webview === null || webview === undefined ? undefined : `WebView ${webview}`];
  return [...parts.filter(part => part !== undefined), ...displayParts(second)].join(", ");
}

/**
 * Whole seconds since the last perf value.
 *
 * @param secondAt - Date.now() when it arrived; undefined before the first.
 * @param now - Date.now().
 * @returns The seconds, rounded down; undefined before the first value.
 * @example
 * ```ts
 * seenSeconds(1000, 2900); // 1
 * ```
 */
export function seenSeconds(secondAt: number | undefined, now: number): number | undefined {
  if (secondAt === undefined) return undefined;
  return Math.max(0, Math.floor((now - secondAt) / MS_PER_SECOND));
}

/**
 * "seen now", "seen 1 s ago", "seen N s ago".
 *
 * @param seconds - Whole seconds since the last value; undefined before the first.
 * @returns The text.
 * @example
 * ```ts
 * seenText(0); // "seen now"
 * ```
 */
export function seenText(seconds: number | undefined): string {
  if (seconds === undefined) return "not seen yet";
  return seconds === 0 ? "seen now" : `seen ${seconds} s ago`;
}

/**
 * The REC clock: minutes and seconds of the log, measured on the phone.
 *
 * @param sinceMs - The recorder's `sinceMs`.
 * @returns "mm:ss".
 * @example
 * ```ts
 * recClock(192_000); // "03:12"
 * ```
 */
export function recClock(sinceMs: number): string {
  const total = Math.max(0, Math.floor(sinceMs / MS_PER_SECOND));
  const minutes = String(Math.floor(total / SECONDS_PER_MINUTE)).padStart(2, "0");
  const seconds = String(total % SECONDS_PER_MINUTE).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/**
 * The loop's rate in the view: undefined before a value or without a rate; `fellBack` when the
 * auto mode runs under the display's rate.
 *
 * @param rate - perf's rate.
 * @returns The view's rate.
 * @example
 * ```ts
 * rateView({ fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }); // { fps: 60, mode: "auto", reason: "missed", fellBack: true }
 * ```
 */
export function rateView(rate: PerfRate | undefined): DeviceStripView["rate"] {
  if (rate === undefined || rate.fps === null) return undefined;
  const fellBack = rate.mode === "auto" && rate.displayHz !== null && rate.fps < rate.displayHz;
  return {
    fps: rate.fps,
    mode: rate.mode ?? undefined,
    reason: rate.reason ?? undefined,
    fellBack
  };
}

/**
 * The `@120` suffix of drawn / loop: cyan, amber after an automatic fall back; the mode, the
 * reason of a fall back and the display rate live in its title only.
 *
 * @param rate - perf's rate.
 * @returns The run; undefined while the rate is unknown.
 * @example
 * ```ts
 * rateSuffix({ fps: 120, mode: "auto", reason: "start", displayHz: 120, switches: 0 });
 * // { text: "@120", tone: "value", title: "120 fps, auto; display 120 Hz" }
 * ```
 */
export function rateSuffix(rate: PerfRate | undefined): StripRun | undefined {
  const view = rateView(rate);
  if (view === undefined) return undefined;

  const parts = [`${view.fps} fps`];
  if (view.mode !== undefined) parts.push(view.mode);
  let title = parts.join(", ");
  if (view.fellBack)
    title += view.reason === undefined ? ", fell back" : `, fell back (${view.reason})`;
  if (rate?.displayHz !== null && rate?.displayHz !== undefined)
    title += `; display ${rate.displayHz} Hz`;
  return { text: `@${view.fps}`, tone: view.fellBack ? "warn" : "value", title };
}

/**
 * The endpoint of a device link: over adb the phone's loopback port, over the LAN the phone's
 * address and the computer port it reached.
 *
 * @param link - The view's link of a device session.
 * @returns "127.0.0.1:47600" or "192.168.1.23 → :47600".
 * @example
 * ```ts
 * endpointOf({ kind: "lan", address: "192.168.1.23", port: 47600 }); // "192.168.1.23 → :47600"
 * ```
 */
function endpointOf(link: Extract<DeviceStripView["link"], { kind: "adb" | "lan" }>): string {
  return link.kind === "adb" ? `${link.address}:${link.port}` : `${link.address} → :${link.port}`;
}

/**
 * The link cell: the outlined legend (ADB / LAN in green, BROWSER in ink-2), the endpoint and
 * "seen N s ago"; while link reports the session silent or lost the legend turns amber and the
 * text reads "silent N s".
 *
 * @param link - The view's link.
 * @param seconds - Seconds since the last perf value.
 * @param status - The link status.
 * @returns The cell.
 */
export function linkCell(
  link: DeviceStripView["link"],
  seconds: number | undefined,
  status: LinkStatus
): LinkCell {
  const silent = status.kind === "silent" || status.kind === "lost";
  const seen = silent ? `silent ${seconds ?? 0} s` : seenText(seconds);
  if (link.kind === "browser")
    return { legend: "BROWSER", tone: silent ? "amber" : "ink2", text: seen };
  return {
    legend: link.kind === "adb" ? "ADB" : "LAN",
    tone: silent ? "amber" : "green",
    text: `${endpointOf(link)}, ${seen}`
  };
}

/**
 * The log cell: lit red `REC mm:ss` while recording, outlined amber `EXPORTING`, outlined ink-2
 * `STOPPED`; undefined for an agent without the recorder source.
 *
 * @param rec - The view's recorder.
 * @returns The cell.
 * @example
 * ```ts
 * recCell({ state: "recording", clock: "03:12" }); // { text: "REC 03:12", tone: "red", lit: true }
 * ```
 */
export function recCell(rec: DeviceStripView["rec"]): RecCell | undefined {
  if (rec === undefined) return undefined;
  if (rec.state === "recording")
    return { text: `REC ${rec.clock ?? "00:00"}`, tone: "red", lit: true };
  if (rec.state === "exporting") return { text: "EXPORTING", tone: "amber", lit: false };
  return { text: "STOPPED", tone: "ink2", lit: false };
}

/**
 * The window's length in whole seconds; 6 before the first window.
 *
 * @param window - The strip's window.
 * @returns Seconds.
 */
function windowSeconds(window: PerfWindowView): number {
  if (window.count === 0) return DEFAULT_WINDOW_SECONDS;
  return Math.max(1, Math.round((window.endMs - window.startMs) / MS_PER_SECOND));
}

/**
 * The drawn / loop segment of the headline, with the rate suffix after the two numbers, e.g.
 * "drawn / loop 54 / 60" and the suffix of 120 fps.
 *
 * @param second - The last perf value.
 * @returns The line.
 */
function fpsLine(second: PerfSecond | undefined): StripLine {
  const fps =
    second === undefined
      ? `${DASH} / ${DASH}`
      : `${whole(second.fps.drawn)} / ${whole(second.fps.loop)}`;
  const suffix = rateSuffix(second?.rate);
  const runs: StripRun[] = [plain("drawn / loop "), value(fps)];
  if (suffix !== undefined) runs.push(plain(" "), suffix);
  runs.push(plain(" fps"));
  return runs;
}

/**
 * The texture segment: art / targets / kept MB, kept from `render.kept.mb` (else the sample's).
 *
 * @param second - The last perf value.
 * @returns The line.
 */
function textureLine(second: PerfSecond | undefined): StripLine {
  const textures = second?.sample?.textures;
  const kept = second?.render?.kept?.mb ?? textures?.kept;
  const numbers =
    textures === undefined
      ? `${DASH} / ${DASH} / ${DASH}`
      : `${whole(textures.art)} / ${whole(textures.targets)} / ${wholeOrDash(kept)}`;
  return [plain("texture "), value(numbers), plain(" MB art / targets / kept")];
}

/**
 * The headline of the last second: spikes in the window, drawn / loop with the rate suffix, p90
 * frame (amber above the budget), GPU average, passes, draws and texture MB.
 *
 * @param second - The last perf value.
 * @param window - The strip's window.
 * @param browser - Whether the session is the game page in the editor's frame.
 * @returns The segments, in order.
 */
export function headline(
  second: PerfSecond | undefined,
  window: PerfWindowView,
  browser: boolean
): StripLine[] {
  const spikes = window.count > 0 ? window.spikeCount : (second?.spikes ?? 0);
  const p90 = second?.sample?.gapMs?.p90;
  const gpu = meanGpu(window);
  const from = browser ? "the browser" : "the phone";
  return [
    [
      plain(`Last ${windowSeconds(window)} s from ${from}, `),
      value(String(spikes), spikes > 0),
      plain(" spikes")
    ],
    fpsLine(second),
    [
      plain("p90 frame "),
      value(
        p90 === undefined ? DASH : p90.toFixed(1),
        p90 !== undefined && p90 > (second?.budgetMs ?? Number.POSITIVE_INFINITY)
      ),
      plain(" ms")
    ],
    gpu === null
      ? [plain(`GPU ${DASH} no timer`)]
      : [plain("GPU "), value(gpu.toFixed(1)), plain(" ms avg")],
    [plain("passes "), value(wholeOrDash(second?.sample?.passes?.mean))],
    [plain("draws "), value(wholeOrDash(second?.sample?.draws?.mean))],
    textureLine(second)
  ];
}

/**
 * The systems item of More: the three slowest by mean; undefined when the sample has none.
 *
 * @param second - The last perf value.
 * @returns The runs.
 */
function systemsItem(second: PerfSecond | undefined): StripRun[] | undefined {
  const systems = second?.sample?.systems;
  if (systems === null || systems === undefined || systems.length === 0) return undefined;
  const top = systems.toSorted((left, right) => right.mean - left.mean).slice(0, 3);
  const text = top.map(system => `${system.name} ${system.mean.toFixed(1)}`).join(ITEM_SEPARATOR);
  return [plain("systems: "), value(`${text} ms`)];
}

/**
 * The renderer items of More: kept pictures and retakes, passes max, rate switches, redraws and
 * rebuilds ("redraws — dev builds only" when the build does not count them).
 *
 * @param second - The last perf value.
 * @returns The items.
 */
function renderItems(second: PerfSecond | undefined): StripRun[][] {
  const render = second?.render ?? undefined;
  const kept = render?.kept ?? undefined;
  const items: StripRun[][] = [
    kept === undefined
      ? [plain(`kept ${DASH}`)]
      : [
          plain("kept "),
          value(whole(kept.pictures)),
          plain(" pictures, "),
          value(whole(kept.retakes)),
          plain(" retakes")
        ],
    [plain("passes max "), value(wholeOrDash(render?.passesMax))],
    [plain("rate switches "), value(wholeOrDash(second?.rate.switches))]
  ];
  const redraws = render?.redraws ?? undefined;
  const rebuilds = render?.rebuilds ?? undefined;
  if (redraws === undefined && rebuilds === undefined)
    items.push([plain(`redraws ${DASH} dev builds only`)]);
  else
    items.push(
      [plain("redraws "), value(wholeOrDash(redraws))],
      [plain("rebuilds "), value(wholeOrDash(rebuilds))]
    );
  return items;
}

/**
 * The screen items of More: views, heap, insets, backend, canvas and the device.
 *
 * @param second - The last perf value.
 * @param model - The device model.
 * @returns The items.
 */
function screenItems(second: PerfSecond | undefined, model: string | undefined): StripRun[][] {
  const sample = second?.sample ?? undefined;
  const display = second?.display ?? undefined;
  const heap = sample?.heapMb ?? undefined;
  const inset = display?.safeArea;
  const backend = display?.backend ?? second?.gpu?.backend;
  const canvas: StripRun[] =
    display === undefined
      ? [plain(`canvas ${DASH}`)]
      : [
          plain("canvas "),
          value(`${display.canvas.w} × ${display.canvas.h}`),
          plain(", scale "),
          value(display.resolution.toFixed(1))
        ];
  const tail = displayParts(second);
  return [
    [plain("views "), value(wholeOrDash(sample?.views))],
    heap === undefined ? [plain(`heap ${DASH}`)] : [plain("heap "), value(`${whole(heap)} MB`)],
    [
      plain("insets "),
      value(inset === undefined ? DASH : `t${inset.t} b${inset.b} l${inset.l} r${inset.r}`)
    ],
    [plain("backend "), value(backend ?? DASH)],
    canvas,
    [
      plain("device "),
      value(model ?? DASH),
      ...(tail.length === 0 ? [] : [plain(`, ${tail.join(", ")}`)])
    ]
  ];
}

/**
 * More: the secondary counters in one line while open, the names of what it holds while closed.
 * Missing values read "—".
 *
 * @param second - The last perf value.
 * @param model - The device model.
 * @param open - Whether More is open.
 * @returns The line.
 */
export function moreText(
  second: PerfSecond | undefined,
  model: string | undefined,
  open: boolean
): StripLine {
  if (!open) return [plain(MORE_CLOSED)];

  const systems = systemsItem(second);
  const filters = second?.sample?.filters?.applies.mean;
  const items: StripRun[][] = [
    ...(systems === undefined ? [] : [systems]),
    [plain("filters "), value(wholeOrDash(filters))],
    ...renderItems(second),
    ...screenItems(second, model)
  ];
  return items.flatMap((item, index) => (index === 0 ? item : [plain(ITEM_SEPARATOR), ...item]));
}

/**
 * What perf can measure, as the view names it.
 *
 * @param state - The strip state.
 * @returns "absent", "no-monitor", "waiting" or "live".
 */
function perfOf(state: DeviceStripState): DeviceStripView["perf"] {
  if (state.perf === "absent") return "absent";
  const kind = state.second?.state;
  if (kind === "off") return "no-monitor";
  return kind === "on" ? "live" : "waiting";
}

/**
 * The strip as it shows now, derived from its state: copies only.
 *
 * @param state - The strip state.
 * @param now - Date.now().
 * @param computerEngine - The computer's engine id (`link.engine()`).
 * @returns The view; undefined while the chosen session has no strip.
 */
export function stripView(
  state: DeviceStripState,
  now: number,
  computerEngine: string | undefined
): DeviceStripView | undefined {
  const { session, second, recorder, record } = state;
  if (session === undefined) return undefined;

  const device = session.device;
  const deviceEngine = second?.engine ?? device?.engine ?? undefined;
  const buildId = second?.build ?? device?.build ?? undefined;
  return {
    session: session.id,
    link:
      device === undefined
        ? { kind: "browser" }
        : { kind: device.link, address: device.address, port: device.port },
    seenSeconds: seenSeconds(state.secondAt, now),
    perf: perfOf(state),
    model: second?.device?.model ?? device?.model ?? undefined,
    about: aboutLine(second),
    backend: second?.display?.backend ?? second?.gpu?.backend,
    rate: rateView(second?.rate),
    engine: {
      device: deviceEngine,
      computer: computerEngine,
      stale: isStale(deviceEngine, computerEngine)
    },
    build: { id: buildId, profile: buildProfile(buildId) },
    rec:
      recorder === undefined
        ? undefined
        : {
            state: recorder.state,
            clock: recorder.state === "recording" ? recClock(recorder.sinceMs) : undefined
          },
    spikes: state.spikes.map(spike => ({ frame: spike.frame, cause: spike.cause })),
    selected: state.selected,
    counter: spikeCounter(state.window, state.selected),
    record: record.kind,
    recordFrame: record.kind === "closed" ? undefined : record.frame,
    more: state.more
  };
}
