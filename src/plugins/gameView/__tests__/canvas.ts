import type { Mock } from "vitest";
import { vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A 2D canvas for happy-dom, which decodes no image and draws nothing: the
// picture reports the given size, the canvas records drawImage and every
// encode, and answers a fixed data URL of the asked type (JPEG or PNG).
// Restore with vi.restoreAllMocks().
// ─────────────────────────────────────────────────────────────────────────────

/** The data URL the stubbed canvas answers for a PNG. */
export const CROP_PNG = "data:image/png;base64,Q1JPUA==";

/** The data URL the stubbed canvas answers for a JPEG (the crop's default, D-34). */
export const CROP_JPEG = "data:image/jpeg;base64,Q1JPUA==";

/** What the stub records. */
export type CanvasStub = {
  readonly drawImage: Mock<(...args: unknown[]) => void>;
  readonly sizes: { readonly width: number; readonly height: number }[];
  /** The type and quality of every `toDataURL` call. */
  readonly encodes: { readonly type: string | undefined; readonly quality: unknown }[];
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
  const encodes: { type: string | undefined; quality: unknown }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
    (type?: string, quality?: unknown) => {
      encodes.push({ type, quality });
      return type === "image/jpeg" ? CROP_JPEG : CROP_PNG;
    }
  );
  return { drawImage, sizes, encodes };
}
