/**
 * @file renderView — the "not built" error of the Mission control skeleton (spec 09 § M17, unit RV0):
 * every typed stub of a file a later build unit writes calls it. Delete this file with the last
 * stub (build wave 4).
 */

/**
 * Throws the two-line "not built" error of a stubbed member.
 *
 * @param name - What was called, for example "series/clearSeries".
 * @param wave - The build wave that writes it.
 * @throws {Error} `[moku-editor] renderView <name> is not built yet.\n  It lands in build wave <wave>.`
 */
export function notBuilt(name: string, wave: 3 | 4): never {
  throw new Error(
    `[moku-editor] renderView ${name} is not built yet.\n  It lands in build wave ${wave}.`
  );
}
