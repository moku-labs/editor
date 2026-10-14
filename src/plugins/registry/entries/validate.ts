/**
 * @file registry plugin — the descriptor rules shared by the catalogue and `add`: the id
 * pattern, the input kinds, and the changes key of a source or the effect and overlay marker of a
 * command.
 */
import type { CommandDescriptor, SourceDescriptor } from "../protocol";
import type { DoorCommand } from "../types";
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
 * The overlay markers of a game command (engine spec 12 H4.4).
 */
const OVERLAYS: ReadonlySet<unknown> = new Set(["toggle", "button"]);

/**
 * Checks the overlay marker of a command: a known marker, and a `value(app)` beside a toggle. The
 * descriptor of a door or module command is the door itself, so its `value` is read from it.
 *
 * @param command - The command descriptor (or the door).
 * @throws {TypeError} `[moku-editor] Command "<id>" has an unknown overlay …` or `… is an overlay toggle without value(app).`
 */
function checkOverlay(command: CommandDescriptor | DoorCommand): void {
  const { id, overlay } = command;
  if (overlay === undefined) return;

  if (!OVERLAYS.has(overlay)) {
    throw new TypeError(
      `[moku-editor] Command "${id}" has an unknown overlay "${String(overlay)}".\n  Use toggle or button.`
    );
  }

  if (overlay === "toggle" && typeof Reflect.get(command, "value") !== "function") {
    throw new TypeError(
      `[moku-editor] Command "${id}" is an overlay toggle without value(app).\n  Give the command a value(app) that answers the switch's state.`
    );
  }
}

/**
 * Checks a descriptor: a dotted id of at most 128 characters, known input kinds, a known changes
 * key (source) or effect and overlay marker (command). Duplicates are the caller's check.
 *
 * @param kind - "source" or "command", for the messages.
 * @param descriptor - The descriptor (or the door, which carries one).
 * @throws {Error} `[moku-editor] …` naming the id and what is wrong; a `TypeError` for the overlay
 *   marker.
 */
export function checkDescriptor(
  kind: "source" | "command",
  descriptor: SourceDescriptor | CommandDescriptor | DoorCommand
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

  if ("effect" in descriptor) checkOverlay(descriptor);
}
