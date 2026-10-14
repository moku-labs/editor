/**
 * @file pages perf sub-domain — the log sink of a perf run: warnings and errors print as the
 * serving bin prints them (`event JSON`); the pairing and adb info events print as sentences;
 * every other info entry and every debug entry is dropped.
 */
import type { BrandConsole } from "@moku-labs/common/cli";

/** One log entry as the app's log hands it to a sink. */
export type PerfLogEntry = {
  readonly level: string;
  readonly event: string;
  readonly data?: unknown;
};

/** A log sink. */
export type PerfLogSink = {
  /**
   * Writes one entry.
   *
   * @param entry - The log entry.
   */
  write(entry: PerfLogEntry): void;
};

/** The fields of an entry's payload. */
type Fields = Readonly<Record<string, unknown>>;

/**
 * The payload of an entry as fields; nothing for a payload that is not an object.
 *
 * @param data - The payload.
 * @returns The fields.
 * @example
 * ```ts
 * fieldsOf({ model: "SM-A266B" }).model; // "SM-A266B"
 * ```
 */
function fieldsOf(data: unknown): Fields {
  return typeof data === "object" && data !== null ? { ...data } : {};
}

/**
 * The name of a phone: its model, or "A phone" without one.
 *
 * @param model - The model field.
 * @returns The name.
 * @example
 * ```ts
 * phoneOf(null); // "A phone"
 * ```
 */
function phoneOf(model: unknown): string {
  return typeof model === "string" && model !== "" ? model : "A phone";
}

/**
 * The info events printed as sentences, each with its printer.
 */
const SENTENCES: Readonly<Record<string, (ui: BrandConsole, data: Fields) => void>> = {
  "hub:paired": (ui, data) => {
    ui.check(true, `${phoneOf(data.model)} linked over ${String(data.link)}`);
  },
  "hub:pair-refused": (ui, data) => {
    ui.check(false, `${phoneOf(data.model)} at ${String(data.address)} was refused`);
  },
  "collector:reversed": (ui, data) => {
    const serial = String(data.serial);
    const port = String(data.port);
    ui.check(
      true,
      `${phoneOf(data.model)} (${serial}): its 127.0.0.1:${port} leads here (adb reverse)`
    );
  },
  "collector:adb-missing": (ui, data) => {
    ui.info(`adb not found: ${String(data.hint)}`);
  },
  "collector:adb-ambiguous": (ui, data) => {
    ui.info(`two ${phoneOf(data.model)} phones over adb: heat and system frames are off for them`);
  }
};

/**
 * The log sink of a perf run: replaces the default console sink (as the serving bin's
 * `forwardLog` does).
 *
 * @param ui - The brand console.
 * @returns The sink for `editor.log.addSink`.
 * @example
 * ```ts
 * editor.log.clearSinks();
 * editor.log.addSink(perfSink(ui)); // hub:paired prints "✓ SM-A266B linked over adb"
 * ```
 */
export function perfSink(ui: BrandConsole): PerfLogSink {
  return {
    write: (entry: PerfLogEntry): void => {
      const { level, event, data } = entry;
      const line = data === undefined ? event : `${event} ${JSON.stringify(data)}`;
      switch (level) {
        case "error": {
          ui.error(line);
          break;
        }
        case "warn": {
          ui.warn(line);
          break;
        }
        // Debug and trace entries are dropped; so is an info entry without a sentence.
        case "info": {
          SENTENCES[event]?.(ui, fieldsOf(data));
          break;
        }
      }
    }
  };
}
