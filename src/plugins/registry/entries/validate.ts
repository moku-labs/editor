/**
 * @file registry plugin — the descriptor rules shared by the catalogue and `add`: the id
 * pattern, the input kinds, and the changes key of a source or the effect of a command.
 */
import type { CommandDescriptor, SourceDescriptor } from "../protocol";
import { ID_PATTERN } from "../types";

/**
 * The longest id the hub's manifest check accepts.
 */
const MAX_ID_LENGTH = 128;

/**
 * The eight input kinds a schema may use.
 */
const KINDS: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "json",
  "string?",
  "number?",
  "boolean?",
  "json?"
]);

/**
 * The change keys of a source.
 */
const CHANGES: ReadonlySet<string> = new Set(["frame", "commit", "edge"]);

/**
 * The effects of a command.
 */
const EFFECTS: ReadonlySet<string> = new Set(["read", "route", "cosmetic", "cheat", "raw"]);

/**
 * Checks a descriptor: a dotted id of at most 128 characters, known input kinds, a known changes
 * key (source) or effect (command). Duplicates are the caller's check.
 *
 * @param kind - "source" or "command", for the messages.
 * @param descriptor - The descriptor (or the door, which carries one).
 * @throws {Error} `[moku-editor] …` naming the id and what is wrong.
 */
export function checkDescriptor(
  kind: "source" | "command",
  descriptor: SourceDescriptor | CommandDescriptor
): void {
  const { id } = descriptor;
  const label = kind === "source" ? "Source" : "Command";

  if (typeof id !== "string" || id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) {
    throw new Error(
      `[moku-editor] Registry id "${String(id)}" is not a dotted name.\n  Name it like "editor.capture": camelCase words joined by dots.`
    );
  }

  for (const [field, declared] of Object.entries(descriptor.input)) {
    if (!KINDS.has(declared)) {
      throw new Error(
        `[moku-editor] ${label} "${id}" has an unknown input kind "${declared}" for "${field}".\n  Use string, number, boolean or json, with an optional ?.`
      );
    }
  }

  if ("changes" in descriptor && !CHANGES.has(descriptor.changes)) {
    throw new Error(
      `[moku-editor] Source "${id}" has an unknown changes "${descriptor.changes}".\n  Use frame, commit or edge.`
    );
  }

  if ("effect" in descriptor && !EFFECTS.has(descriptor.effect)) {
    throw new Error(
      `[moku-editor] Command "${id}" has an unknown effect "${descriptor.effect}".\n  Use read, route, cosmetic, cheat or raw.`
    );
  }
}
