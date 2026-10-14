/**
 * @file pages perf sub-domain — the log sink of a perf run: warnings and errors print as the
 * serving bin prints them (`event JSON`); the pairing and adb info events print as sentences;
 * every other info entry and every debug entry is dropped.
 */
import type { LogEntry, LogSink } from "@moku-labs/common";
import type { BrandConsole } from "@moku-labs/common/cli";
import { cleanText } from "../../perf/protocol";

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
 * A printable field: a non-empty string as clean text, a finite number; else undefined, so a
 * missing field never prints "undefined".
 *
 * @param value - The field.
 * @returns The text, or undefined.
 * @example
 * ```ts
 * textOf("R5\u001b[2J"); // "R5[2J"
 * ```
 */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : cleanText(value);
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
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
  return textOf(model) ?? "A phone";
}

/**
 * A field with its lead-in, or nothing when the field is missing.
 *
 * @param lead - The words before the field, e.g. " over ".
 * @param value - The field.
 * @param tail - The words after it.
 * @returns e.g. " over adb", or "".
 * @example
 * ```ts
 * part(" (", "R5CX30ABCDE", ")"); // " (R5CX30ABCDE)"
 * ```
 */
function part(lead: string, value: unknown, tail = ""): string {
  const text = textOf(value);
  return text === undefined ? "" : `${lead}${text}${tail}`;
}

/**
 * The info events printed as sentences, each with its printer.
 */
const SENTENCES: Readonly<Record<string, (ui: BrandConsole, data: Fields) => void>> = {
  "hub:paired": (ui, data) => {
    ui.check(true, `${phoneOf(data.model)} linked${part(" over ", data.link)}`);
  },
  "hub:pair-refused": (ui, data) => {
    ui.check(false, `${phoneOf(data.model)}${part(" at ", data.address)} was refused`);
  },
  "collector:reversed": (ui, data) => {
    const port = textOf(data.port);
    const target = port === undefined ? "device port" : `127.0.0.1:${port}`;
    const serial = part(" (", data.serial, ")");
    ui.check(true, `${phoneOf(data.model)}${serial}: its ${target} leads here (adb reverse)`);
  },
  "collector:adb-missing": (ui, data) => {
    ui.info(`adb not found${part(": ", data.hint)}`);
  },
  "collector:adb-ambiguous": (ui, data) => {
    const model = textOf(data.model) ?? "same-model";
    ui.info(`two ${model} phones over adb: heat and system frames are off for them`);
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
export function perfSink(ui: BrandConsole): LogSink {
  return {
    write: (entry: LogEntry): void => {
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
