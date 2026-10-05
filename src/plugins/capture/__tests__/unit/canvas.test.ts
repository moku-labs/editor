import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodePicture } from "../../canvas";
import { PNG, rejectionOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The page decoder of editor.capture over a fake canvas: createImageBitmap
// decodes the data URL, an OffscreenCanvas (or a canvas element when there is
// none) draws it smaller and encodes a PNG data URL.
// ─────────────────────────────────────────────────────────────────────────────

/** The bytes the fake canvases encode, and their base64. */
const ENCODED = new Uint8Array([1, 2, 3]);
const ENCODED_BASE64 = "AQID";

/** One drawImage call: the bitmap and the target rectangle. */
type Draw = readonly [bitmap: object, x: number, y: number, width: number, height: number];

/** A 2d context fake that records its draws. */
type FakeContext = {
  imageSmoothingQuality: string;
  readonly draws: Draw[];
  drawImage(...draw: Draw): void;
};

/**
 * Builds a 2d context fake.
 *
 * @returns The context.
 */
function fakeContext(): FakeContext {
  const context: FakeContext = {
    imageSmoothingQuality: "low",
    draws: [],
    drawImage: (...draw) => {
      context.draws.push(draw);
    }
  };
  return context;
}

/** An OffscreenCanvas fake: records each canvas made, its context and its encode options. */
class FakeOffscreenCanvas {
  static readonly made: FakeOffscreenCanvas[] = [];
  /** Whether getContext answers a context; a test flips it through this holder. */
  static readonly setup = { hasContext: true };
  readonly context = fakeContext();
  options: unknown;

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    FakeOffscreenCanvas.made.push(this);
  }

  getContext(_type: "2d"): FakeContext | null {
    // eslint-disable-next-line unicorn/no-null -- a canvas answers null when it has no 2d context
    return FakeOffscreenCanvas.setup.hasContext ? this.context : null;
  }

  async convertToBlob(options: unknown): Promise<Blob> {
    this.options = options;
    return new Blob([ENCODED], { type: "image/png" });
  }
}

/** The decoded bitmap the fake createImageBitmap answers. */
const bitmap = { width: 1080, height: 1920, close: vi.fn() };

/** The fake createImageBitmap; records the blob it decoded. */
const createImageBitmap = vi.fn(async (_blob: Blob) => bitmap);

beforeEach(() => {
  FakeOffscreenCanvas.made.length = 0;
  FakeOffscreenCanvas.setup.hasContext = true;
  bitmap.close.mockClear();
  createImageBitmap.mockClear();
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodePicture", () => {
  it("decodes the data URL bytes into a bitmap of the picture's size", async () => {
    const picture = await decodePicture("data:image/png;base64,AQID");

    expect(picture).toMatchObject({ width: 1080, height: 1920 });
    const blob = createImageBitmap.mock.calls[0]?.[0];
    expect(blob?.type).toBe("image/png");
    expect(new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(ENCODED);
  });

  it("draws it on an OffscreenCanvas at the given size and answers a PNG data URL", async () => {
    const picture = await decodePicture(PNG);

    const png = await picture.toPng(540, 960);

    expect(png).toBe(`data:image/png;base64,${ENCODED_BASE64}`);
    const [canvas] = FakeOffscreenCanvas.made;
    expect(canvas).toMatchObject({ width: 540, height: 960, options: { type: "image/png" } });
    expect(canvas?.context.draws).toEqual([[bitmap, 0, 0, 540, 960]]);
    expect(canvas?.context.imageSmoothingQuality).toBe("high");
  });

  it("frees the bitmap on close", async () => {
    const picture = await decodePicture(PNG);

    picture.close();

    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("draws on a canvas element when the page has no OffscreenCanvas", async () => {
    const context = fakeContext();
    const element = {
      width: 0,
      height: 0,
      getContext: (_type: "2d") => context,
      toDataURL: vi.fn((_type: string) => "data:image/png;base64,ELEMENT")
    };
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", { createElement: (_tag: "canvas") => element });

    const picture = await decodePicture(PNG);
    const png = await picture.toPng(270, 480);

    expect(png).toBe("data:image/png;base64,ELEMENT");
    expect(element).toMatchObject({ width: 270, height: 480 });
    expect(element.toDataURL).toHaveBeenCalledWith("image/png");
    expect(context.draws).toEqual([[bitmap, 0, 0, 270, 480]]);
  });

  it("rejects without a canvas in the page", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", undefined);
    const picture = await decodePicture(PNG);

    expect(await rejectionOf(picture.toPng(270, 480))).toMatchObject({
      message:
        "[moku-editor] editor.capture: no canvas in this page.\n  Downscaling needs a browser page."
    });
  });

  it("rejects when the canvas has no 2d context", async () => {
    FakeOffscreenCanvas.setup.hasContext = false;
    const picture = await decodePicture(PNG);

    expect(await rejectionOf(picture.toPng(270, 480))).toMatchObject({
      message:
        "[moku-editor] editor.capture: the canvas has no 2d context.\n  Downscaling needs a browser page."
    });
  });

  it("rejects without createImageBitmap", async () => {
    vi.stubGlobal("createImageBitmap", undefined);

    expect(await rejectionOf(decodePicture(PNG))).toMatchObject({
      message:
        "[moku-editor] editor.capture: no createImageBitmap in this page.\n  Downscaling needs a browser page."
    });
  });

  it("rejects a picture that is not a base64 data URL", async () => {
    expect(await rejectionOf(decodePicture("https://example.test/shot.png"))).toMatchObject({
      message:
        "[moku-editor] editor.capture: the picture is not a base64 data URL.\n  The door answers a PNG data URL."
    });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});
