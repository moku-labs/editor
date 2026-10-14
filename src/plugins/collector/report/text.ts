/**
 * @file collector/report — the text the perf CLI prints: the game's text table (Markdown-compatible
 * pipes), the lines of `perf summary` and of `perf compare`. Every string that came from a phone
 * (paths, builds, labels, devices, sensor names, rate reasons) goes through `cleanText`, so a log
 * cannot write control or bidi characters into a terminal. Pure: summaries in, lines out.
 */
import { cleanText } from "../../perf/protocol";
import type {
  Comparison,
  Delta,
  HeatSummary,
  HistPercentile,
  LogSummary,
  ScreenSummary
} from "./types";

/** The cell of a missing value. */
const DASH = "—";

/** The separator of the parts of a line. */
const DOT = " · ";

/** The title of the frame-event block; the block's next lines are indented under it. */
const SCREEN_EVENTS = "Screen events: ";

/** The head of the screens table. */
const SCREEN_HEAD = [
  "screen",
  "rate",
  "frames",
  "p50",
  "p90",
  "p99",
  "gpu",
  "spikes",
  "passes",
  "tex MB art/tgt/kept",
  "heap"
];

/** The head of the system frames table. */
const SYSTEM_HEAD = ["device", "mark", "seconds", "frames", "fps", "late %", "p50", "p90", "p99"];

/** The head of the comparison table. */
const COMPARE_HEAD = [
  "screen",
  "rate",
  "p90 A → B",
  "p99 A → B",
  "spikes/min A → B",
  "gpu A → B",
  "worse"
];

/** The skipped reasons of the footer, in the order they are printed. */
const SKIPPED_WORDS: readonly (readonly [keyof LogSummary["skipped"], string])[] = [
  ["otherVersion", "of a newer log version"],
  ["notJson", "not JSON"],
  ["noVersion", "without a version"],
  ["unknownKind", "of an unknown kind"],
  ["badShape", "malformed"]
];

/**
 * Lays rows out as the game's text table: every column as wide as its widest cell, name columns
 * padded right, number columns left; Markdown-compatible pipes.
 *
 * @param head - The column names.
 * @param rows - The rows of cells.
 * @param names - How many columns from the left hold names.
 * @returns The lines of the table.
 * @example
 * ```ts
 * table(["path", "fps"], [["ward", "59.8"]]); // ["| path |  fps |", "|------|------|", "| ward | 59.8 |"]
 * ```
 */
export function table(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  names = 1
): string[] {
  const widths = head.map((name, column) =>
    Math.max(name.length, ...rows.map(row => (row[column] ?? "").length))
  );
  const line = (cells: readonly string[]): string =>
    `| ${cells
      .map((cell, column) =>
        column < names ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0)
      )
      .join(" | ")} |`;

  return [
    line(head),
    `|${widths.map(width => "-".repeat(width + 2)).join("|")}|`,
    ...rows.map(row => line(row))
  ];
}

/**
 * A number with one decimal, or the dash.
 *
 * @param value - The number or null.
 * @returns The cell.
 * @example
 * ```ts
 * oneDecimal(4.83); // "4.8"
 * ```
 */
function oneDecimal(value: number | null): string {
  return value === null ? DASH : value.toFixed(1);
}

/**
 * A phone's text as a cell: clean, or the dash.
 *
 * @param value - The text or null.
 * @returns The cell.
 * @example
 * ```ts
 * textCell("garden\u202E/boss"); // "garden/boss"
 * ```
 */
function textCell(value: string | null): string {
  return value === null ? DASH : cleanText(value);
}

/**
 * A whole number, or the dash.
 *
 * @param value - The number or null.
 * @returns The cell.
 * @example
 * ```ts
 * whole(150.6); // "151"
 * ```
 */
function whole(value: number | null): string {
  return value === null ? DASH : String(Math.round(value));
}

/**
 * A percentile cell: whole ms, `≥200` for the over bucket, the dash for none.
 *
 * @param percentile - The percentile.
 * @returns The cell.
 * @example
 * ```ts
 * percentileCell({ ms: 200, over: true }); // "≥200"
 * ```
 */
function percentileCell(percentile: HistPercentile | null): string {
  if (percentile === null) return DASH;

  return percentile.over ? `≥${percentile.ms}` : String(percentile.ms);
}

/**
 * Two digits.
 *
 * @param value - A whole number.
 * @returns It, padded with a zero.
 * @example
 * ```ts
 * twoDigits(4); // "04"
 * ```
 */
function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A moment of a log as minutes and seconds.
 *
 * @param seconds - Seconds from the first sample.
 * @returns `mm:ss`.
 * @example
 * ```ts
 * clockOf(482); // "08:02"
 * ```
 */
function clockOf(seconds: number): string {
  return `${twoDigits(Math.floor(seconds / 60))}:${twoDigits(Math.floor(seconds % 60))}`;
}

/**
 * The length of a log in words.
 *
 * @param seconds - Its seconds.
 * @returns e.g. "12 min 4 s".
 * @example
 * ```ts
 * durationOf(724); // "12 min 4 s"
 * ```
 */
function durationOf(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes} min ${total % 60} s` : `${total} s`;
}

/**
 * A count with a space between thousands, as the report tables and the perf CLI print it.
 *
 * @param value - The count.
 * @returns e.g. "1 840".
 * @example
 * ```ts
 * groupThousands(1840); // "1 840"
 * ```
 */
export function groupThousands(value: number): string {
  const digits = String(value);
  const head = digits.length % 3;
  const groups = head > 0 ? [digits.slice(0, head)] : [];
  for (let index = head; index < digits.length; index += 3)
    groups.push(digits.slice(index, index + 3));

  return groups.join(" ");
}

/**
 * The spikes cell: the count and its primary causes, most first.
 *
 * @param screen - The row.
 * @returns e.g. "9 (js 5, upload 4)".
 * @example
 * ```ts
 * spikesCell({ ...screen, spikes: 2, causes: [["upload", 1], ["js", 1]] }); // "2 (upload 1, js 1)"
 * ```
 */
function spikesCell(screen: ScreenSummary): string {
  if (screen.causes.length === 0) return String(screen.spikes);

  const named = screen.causes.map(([cause, count]) => `${cause} ${count}`);
  return `${screen.spikes} (${named.join(", ")})`;
}

/**
 * The cells of a screen row.
 *
 * @param screen - The row.
 * @returns The cells, SCREEN_HEAD order.
 */
function screenCells(screen: ScreenSummary): string[] {
  const { art, targets, kept } = screen.textureMb;
  return [
    cleanText(screen.path),
    whole(screen.rate),
    String(screen.frames),
    percentileCell(screen.p50),
    percentileCell(screen.p90),
    percentileCell(screen.p99),
    oneDecimal(screen.gpuMs),
    spikesCell(screen),
    oneDecimal(screen.passes),
    `${Math.round(art)} / ${Math.round(targets)} / ${Math.round(kept)}`,
    whole(screen.heapMb)
  ];
}

/**
 * The game's overlay changes of a screen, grouped by label: `<label> <what> ×<count>, …`.
 *
 * @param overlays - The screen's overlay entries.
 * @returns The text.
 * @example
 * ```ts
 * overlaysText([{ label: "shopDimLayer", what: "open", count: 2 }, { label: "shopDimLayer", what: "kept", count: 1 }]); // "shopDimLayer open ×2, kept ×1"
 * ```
 */
function overlaysText(overlays: ScreenSummary["overlays"]): string {
  const byLabel = new Map<string, string[]>();
  for (const { label, what, count } of overlays) {
    const name = cleanText(label);
    const parts = byLabel.get(name) ?? [];
    parts.push(`${what} ×${count}`);
    byLabel.set(name, parts);
  }

  return [...byLabel].map(([label, parts]) => `${label} ${parts.join(", ")}`).join("; ");
}

/**
 * The frame-event line of a screen, or undefined when it has none.
 *
 * @param screen - The row.
 * @returns `<path> @<rate>: pool trims … · warm-ups … · overlays …`.
 */
function screenEventsOf(screen: ScreenSummary): string | undefined {
  const { poolTrims, warmUps, overlays } = screen;
  const parts: string[] = [];
  if (poolTrims.count > 0)
    parts.push(`pool trims ${poolTrims.count} (−${poolTrims.freedMb.toFixed(1)} MB)`);
  if (warmUps.count > 0) parts.push(`warm-ups ${warmUps.count} (${warmUps.draws} draws)`);
  if (overlays.length > 0) parts.push(`overlays ${overlaysText(overlays)}`);

  return parts.length === 0
    ? undefined
    : `${cleanText(screen.path)} @${whole(screen.rate)}: ${parts.join(DOT)}`;
}

/**
 * The Screen events block: one line per screen and rate with a frame event, the first carrying the
 * title, the others indented under it; nothing for a log without frame events.
 *
 * @param screens - The rows.
 * @returns The lines.
 */
function screenEventsBlock(screens: readonly ScreenSummary[]): string[] {
  const indent = " ".repeat(SCREEN_EVENTS.length);
  return screens
    .map(screen => screenEventsOf(screen))
    .filter(line => line !== undefined)
    .map((line, index) => `${index === 0 ? SCREEN_EVENTS : indent}${line}`);
}

/**
 * The heat line of a device.
 *
 * @param heat - Its heat.
 * @returns `Heat of <device>: battery … °C (max …), thermal status … (max …), <sensor> … → …`.
 */
function heatLine(heat: HeatSummary): string {
  const parts: string[] = [];
  const { batteryC, status } = heat;
  if (batteryC.first !== null && batteryC.last !== null && batteryC.max !== null) {
    parts.push(
      `battery ${batteryC.first.toFixed(1)} → ${batteryC.last.toFixed(1)} °C (max ${batteryC.max.toFixed(1)})`
    );
  }
  if (status.first !== null) {
    parts.push(`thermal status ${status.first} → ${status.last} (max ${status.max})`);
  }
  for (const sensor of heat.sensors) {
    parts.push(`${cleanText(sensor.name)} ${sensor.first.toFixed(1)} → ${sensor.last.toFixed(1)}`);
  }

  return `Heat of ${cleanText(heat.device)}: ${parts.length > 0 ? parts.join(", ") : "no reading"}`;
}

/**
 * The footer: lines read, lines skipped by reason, lines lost on the device.
 *
 * @param summary - The summary.
 * @returns e.g. "1 840 lines · 3 skipped (2 of a newer log version, 1 not JSON) · 12 lost on the device".
 */
function footerOf(summary: LogSummary): string {
  const parts = [`${groupThousands(summary.lines)} lines`];
  const reasons = SKIPPED_WORDS.filter(([key]) => summary.skipped[key] > 0).map(
    ([key, words]) => `${summary.skipped[key]} ${words}`
  );
  const skipped = SKIPPED_WORDS.reduce((sum, [key]) => sum + summary.skipped[key], 0);
  if (skipped > 0) parts.push(`${skipped} skipped (${reasons.join(", ")})`);
  if (summary.lost > 0) parts.push(`${groupThousands(summary.lost)} lost on the device`);

  return parts.join(DOT);
}

/**
 * The lines `perf summary` prints: the device line, the screens table (one row per screen and
 * rate), the rate switches, the screens' frame events, the heat, the system frames per mark, the
 * marks and the footer. `≥200` for an over percentile, `—` for a missing value; whole ms for
 * percentiles, one decimal for means. A block with nothing to say is left out.
 *
 * @param summary - The summary of a log.
 * @returns The lines.
 * @example
 * ```ts
 * summaryText(summarize(parsePerfLog(text)))[0]; // "SM-A266B · webgpu · engine 0.14.12+9c41e0 · build debug-20261014T160000Z · 12 min 4 s"
 * ```
 */
export function summaryText(summary: LogSummary): string[] {
  const { device, screens, rateSwitches, heat, system, marks } = summary;
  const lines = [
    [
      textCell(device.model),
      textCell(device.backend),
      `engine ${textCell(device.engine)}`,
      `build ${textCell(device.build)}`,
      durationOf(summary.seconds)
    ].join(DOT)
  ];
  if (screens.length > 0)
    lines.push(
      ...table(
        SCREEN_HEAD,
        screens.map(screen => screenCells(screen))
      )
    );
  if (rateSwitches.length > 0) {
    const switches = rateSwitches.map(
      item =>
        `${clockOf(item.at)} ${item.from} → ${item.to} (${cleanText(item.reason)}, ${cleanText(item.mode)})`
    );
    lines.push(`Rate: ${switches.join(DOT)}`);
  }
  lines.push(...screenEventsBlock(screens), ...heat.map(item => heatLine(item)));
  if (system.length > 0) {
    const rows = system.map(item => [
      cleanText(item.device),
      cleanText(item.mark),
      whole(item.seconds),
      String(item.frames),
      oneDecimal(item.fps),
      oneDecimal(item.latePct),
      String(item.p50),
      String(item.p90),
      String(item.p99)
    ]);
    lines.push("System frames (adb gfxinfo)", ...table(SYSTEM_HEAD, rows, 2));
  }
  if (marks.length > 0) {
    const named = marks.map(
      mark => `${clockOf(mark.at)} ${cleanText(mark.label)}${mark.auto ? " (auto)" : ""}`
    );
    lines.push(`Marks: ${named.join(DOT)}`);
  }
  lines.push(footerOf(summary));

  return lines;
}

/**
 * A compared cell: `A → B`, then the arrow and the change when there is one.
 *
 * @param delta - The compared metric.
 * @param format - How a value is written.
 * @returns e.g. "18 → 13 ▼28%", "5 → 5", "— → 12".
 */
function deltaCell(delta: Delta, format: (value: number | null) => string): string {
  const change = delta.pct === null ? "" : `${Math.abs(delta.pct)}%`;
  const arrow = delta.arrow === null ? "" : ` ${delta.arrow}${change}`;

  return `${format(delta.a)} → ${format(delta.b)}${arrow}`;
}

/**
 * A log's rate switches on one line of the comparison.
 *
 * @param name - "A" or "B".
 * @param summary - The log's summary.
 * @returns e.g. "A: 120 → 60 at 08:02 (missed)", or "B: no switch".
 */
function switchesLine(name: string, summary: LogSummary): string {
  const switches = summary.rateSwitches.map(
    item => `${item.from} → ${item.to} at ${clockOf(item.at)} (${cleanText(item.reason)})`
  );

  return `${name}: ${switches.length > 0 ? switches.join(DOT) : "no switch"}`;
}

/**
 * The lines `perf compare` prints: a heading naming both files, one row per screen and rate with
 * `A → B` cells and ▲/▼ at ±10 %, then one line per log with its rate switches (left out when
 * neither log switched).
 *
 * @param comparison - What compare answered.
 * @param names - The two files' names.
 * @param names.a - Log A's name.
 * @param names.b - Log B's name.
 * @returns The lines.
 * @example
 * ```ts
 * compareText(compare(a, b), { a: "before.jsonl", b: "after.jsonl" })[0]; // "Compare A before.jsonl → B after.jsonl"
 * ```
 */
export function compareText(comparison: Comparison, names: { a: string; b: string }): string[] {
  const rows = comparison.rows.map(row => [
    cleanText(row.path),
    whole(row.rate),
    deltaCell(row.p90, whole),
    deltaCell(row.p99, whole),
    deltaCell(row.spikesPerMin, oneDecimal),
    deltaCell(row.gpuMs, oneDecimal),
    row.worse.join(", ")
  ]);
  const lines = [`Compare A ${names.a} → B ${names.b}`, ...table(COMPARE_HEAD, rows)];
  if (comparison.a.rateSwitches.length > 0 || comparison.b.rateSwitches.length > 0) {
    lines.push(switchesLine("A", comparison.a), switchesLine("B", comparison.b));
  }

  return lines;
}
