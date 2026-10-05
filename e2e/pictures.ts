/**
 * @file The picture checks of the e2e specs: a pick, the Game Shot and MCP crops are JPEG by
 * default (D-34), a series frame stays PNG. Each reader checks the signature first, then reads the
 * pixel size from the header: the IHDR chunk of a PNG, the first SOF marker of a JPEG.
 */
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";

/** A picture size in pixels. */
export type PixelSize = { readonly w: number; readonly h: number };

/** The eight signature bytes of a PNG. */
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The SOI marker and the first marker byte every JPEG starts with. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** The JPEG start-of-frame markers that carry the size (SOF0–SOF15 without DHT, JPG and DAC). */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

/**
 * The size of a PNG file, after checking its signature.
 *
 * @param file - The absolute path.
 * @returns Width and height from the IHDR chunk.
 */
export async function pngSize(file: string): Promise<PixelSize> {
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 8)], `${file} is a PNG`).toEqual(PNG_SIGNATURE);
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

/**
 * The size of a JPEG file, after checking its signature: the segments are walked to the first
 * start-of-frame marker.
 *
 * @param file - The absolute path.
 * @returns Width and height from the SOF segment.
 */
export async function jpegSize(file: string): Promise<PixelSize> {
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 3)], `${file} is a JPEG`).toEqual(JPEG_SIGNATURE);
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error(`${file}: no JPEG marker at byte ${at}`);
    const marker = bytes[at + 1] ?? 0;
    if (SOF_MARKERS.has(marker)) {
      return { w: bytes.readUInt16BE(at + 7), h: bytes.readUInt16BE(at + 5) };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error(`${file}: no JPEG start-of-frame marker`);
}
