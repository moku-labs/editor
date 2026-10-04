import type { Mock } from "vitest";
import { vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A 2D canvas for happy-dom, which decodes no image and draws nothing: the
// picture reports the given size, the canvas records drawImage and answers a
// fixed data URL. Restore with vi.restoreAllMocks().
// ─────────────────────────────────────────────────────────────────────────────

/** The data URL the stubbed canvas answers. */
export const CROP_PNG = "data:image/png;base64,Q1JPUA==";

/** What the stub records. */
export type CanvasStub = {
  readonly drawImage: Mock<(...args: unknown[]) => void>;
  readonly sizes: { readonly width: number; readonly height: number }[];
};

/**
 * Stubs image decoding and the 2D canvas.
 *
 * @param picture - The size every decoded picture reports.
 * @param picture.width - Its width in pixels.
 * @param picture.height - Its height in pixels.
 * @returns The recorded calls.
 */
export function stubCanvas(picture: {
  readonly width: number;
  readonly height: number;
}): CanvasStub {
  const drawImage = vi.fn<(...args: unknown[]) => void>();
  const sizes: { width: number; height: number }[] = [];
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(picture.width);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(picture.height);
  const context = { drawImage } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    sizes.push({ width: this.width, height: this.height });
    return context;
  } as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(CROP_PNG);
  return { drawImage, sizes };
}
