/**
 * @file Shared view module — scene: the texture catalogue from the game's asset manifest.
 */
import type { TextureCatalogue } from "./types";

/**
 * Parses a version-1 asset manifest: textures (fonts and audio dropped), gpuMb = w·h·4 / 2^20.
 *
 * @param _text - The manifest text.
 * @param _path - Where it was found.
 * @example
 * ```ts
 * const catalogue = parseTextureManifest(text, "manifest.json");
 * ```
 */
export function parseTextureManifest(_text: string, _path: string): TextureCatalogue | undefined {
  throw new Error("not implemented");
}
