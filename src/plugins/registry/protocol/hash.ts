/**
 * @file Protocol — commandsHash (D-37): one hash of the command doors of a manifest, the same rule
 * for the hub, which stamps it on every `SessionInfo`, and for the tests. Pure and isomorphic:
 * no Node or browser API.
 */
import type { CommandDescriptor, InputSchema, Manifest } from "./types";

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x81_1c_9d_c5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01_00_01_93;

/**
 * Orders two strings by their UTF-16 code units, the same in every runtime and locale.
 *
 * @param left - One string.
 * @param right - The other string.
 * @returns A negative number, zero or a positive number, as `Array.prototype.sort` wants.
 * @example
 * ```ts
 * ["game.tap", "editor.capture"].toSorted(byCodeUnits); // ["editor.capture", "game.tap"]
 * ```
 */
function byCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * The input of a door with its keys in code-unit order, so the key order of the game's source
 * does not move the hash.
 *
 * @param input - The input schema of a door.
 * @returns A copy with sorted keys.
 * @example
 * ```ts
 * sortedInput({ x: "number", target: "string" }); // { target: "string", x: "number" }
 * ```
 */
function sortedInput(input: InputSchema): InputSchema {
  const fields = Object.entries(input).toSorted(([left], [right]) => byCodeUnits(left, right));

  return Object.fromEntries(fields);
}

/**
 * The canonical line of one door: the JSON of `[id, effect, input]`. The title is left out: a
 * renamed title changes no schema.
 *
 * @param command - A command door of the manifest.
 * @returns One line of JSON.
 * @example
 * ```ts
 * canonicalLine({ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route" });
 * // '["game.tap","route",{"target":"string"}]'
 * ```
 */
function canonicalLine(command: CommandDescriptor): string {
  return JSON.stringify([command.id, command.effect, sortedInput(command.input)]);
}

/**
 * FNV-1a 32-bit over the UTF-16 code units of a text, as 8 lowercase hex chars.
 *
 * @param text - Any text.
 * @returns The hash, zero-padded.
 * @example
 * ```ts
 * fnv1a(""); // "811c9dc5"
 * ```
 */
function fnv1a(text: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index++) {
    // eslint-disable-next-line unicorn/prefer-code-point -- the rule hashes UTF-16 code units (D-37)
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/**
 * The hash of the command doors of a manifest: the canonical lines (`[id, effect, input]`, input
 * keys sorted) of the commands sorted by id, joined with `\n`, through FNV-1a 32-bit. Titles,
 * sources and the page fields do not count. The hub stamps it on `SessionInfo.manifestHash`; the
 * MCP bridge rebuilds its door tools only when it moves.
 *
 * @param manifest - The manifest a game sent in `hello`.
 * @returns 8 lowercase hex chars.
 * @example
 * ```ts
 * // The hub, on hello: the same commands in any order give the same hash.
 * commandsHash({ ...manifest, commands: [{ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route" }] });
 * // "4f528e73"
 * commandsHash({ ...manifest, commands: [] }); // "811c9dc5"
 * ```
 */
export function commandsHash(manifest: Manifest): string {
  const lines = manifest.commands.map(command => ({
    id: command.id,
    line: canonicalLine(command)
  }));
  const sorted = lines.toSorted(
    (left, right) => byCodeUnits(left.id, right.id) || byCodeUnits(left.line, right.line)
  );

  return fnv1a(sorted.map(entry => entry.line).join("\n"));
}
