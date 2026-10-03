/**
 * @file Shared view module — scene: the texture catalogue from the game's asset manifest.
 */
import type { Json } from "../../../registry/protocol";
import type { TextureCatalogue, TextureInfo } from "./types";
import type { JsonObject } from "./wire";
import { isJsonObject, numberOf, stringOf } from "./wire";

/**
 * The manifest version this module reads.
 */
const MANIFEST_VERSION = 1;

/**
 * Bytes per texel of an RGBA texture on the GPU.
 */
const BYTES_PER_TEXEL = 4;

/**
 * Bytes in one MB (2^20).
 */
const BYTES_PER_MB = 1_048_576;

/**
 * One bundle of the catalogue: tier, file count and file MB.
 */
type BundleInfo = { readonly tier: string; readonly files: number; readonly fileMb: number };

/**
 * Parses JSON text without throwing.
 *
 * @param text - The text.
 * @returns The value, or undefined for invalid JSON.
 * @example
 * ```ts
 * parseJson("{"); // undefined
 * ```
 */
function parseJson(text: string): Json | undefined {
  try {
    const value: Json = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * GPU memory of an RGBA texture in MB, 2 decimals: width·height·4 / 2^20.
 *
 * @param width - Width in px.
 * @param height - Height in px.
 * @returns The MB.
 * @example
 * ```ts
 * gpuMbOf(1024, 1024); // 4
 * ```
 */
function gpuMbOf(width: number, height: number): number {
  return Math.round(((width * height * BYTES_PER_TEXEL) / BYTES_PER_MB) * 100) / 100;
}

/**
 * Reads one manifest file as a texture: kind "texture" or absent, with key, size and MB.
 *
 * @param file - One file of a bundle.
 * @param bundle - The bundle name.
 * @returns The texture, or undefined for fonts, audio and files of the wrong shape.
 * @example
 * ```ts
 * textureOf({ key: "board.cell", path: "cell.webp", width: 1024, height: 1024, mb: 4 }, "board")?.gpuMb; // 4
 * ```
 */
function textureOf(file: Json, bundle: string): TextureInfo | undefined {
  if (!isJsonObject(file)) return undefined;

  const kind = file.kind ?? "texture";
  const key = stringOf(file.key);
  const width = numberOf(file.width);
  const height = numberOf(file.height);
  const fileMb = numberOf(file.mb);

  if (kind !== "texture" || key === undefined) return undefined;
  if (width === undefined || height === undefined || fileMb === undefined) return undefined;

  return { key, bundle, width, height, gpuMb: gpuMbOf(width, height), fileMb };
}

/**
 * Adds one bundle to the catalogue: its textures, and its tier, file count and MB.
 *
 * @param name - The bundle name.
 * @param bundle - The bundle value.
 * @param textures - Texture key to texture, filled in.
 * @param bundles - Bundle name to its summary, filled in.
 * @example
 * ```ts
 * addBundle("board", { tier: "scene", mb: 4, files: [] }, textures, bundles);
 * ```
 */
function addBundle(
  name: string,
  bundle: JsonObject,
  textures: Map<string, TextureInfo>,
  bundles: Map<string, BundleInfo>
): void {
  const tier = stringOf(bundle.tier);
  const fileMb = numberOf(bundle.mb);
  const { files } = bundle;

  if (tier === undefined || fileMb === undefined || !Array.isArray(files)) return;

  for (const file of files) {
    const texture = textureOf(file, name);

    if (texture !== undefined) textures.set(texture.key, texture);
  }

  bundles.set(name, { tier, files: files.length, fileMb });
}

/**
 * Parses a version-1 asset manifest `{ version: 1, bundles: { name: { tier, mb, files } } }`:
 * textures only (fonts and audio dropped), gpuMb = w·h·4 / 2^20 with 2 decimals, and per bundle
 * its tier, file count and file MB. A bundle or file of the wrong shape is skipped.
 *
 * @param text - The manifest text.
 * @param path - Where it was found.
 * @returns The catalogue, or undefined for invalid JSON, another version or no bundles.
 * @example
 * ```ts
 * const catalogue = parseTextureManifest(text, "manifest.json");
 * catalogue?.textures.get("board.cell")?.gpuMb; // 4 for 1024×1024
 * ```
 */
export function parseTextureManifest(text: string, path: string): TextureCatalogue | undefined {
  const manifest = parseJson(text);

  if (!isJsonObject(manifest) || manifest.version !== MANIFEST_VERSION) return undefined;
  if (!isJsonObject(manifest.bundles)) return undefined;

  const textures = new Map<string, TextureInfo>();
  const bundles = new Map<string, BundleInfo>();

  for (const [name, bundle] of Object.entries(manifest.bundles)) {
    if (isJsonObject(bundle)) addBundle(name, bundle, textures, bundles);
  }

  return { path, textures, bundles };
}
