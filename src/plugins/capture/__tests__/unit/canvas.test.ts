import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodePicture } from "../../canvas";
import { PNG, rejectionOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The page decoder of editor.capture over a fake canvas: createImageBitmap
// decodes the data URL, an OffscreenCanvas (or a canvas element when there is
// none) draws it (cropped, smaller) and encodes a JPEG or PNG data URL.
// ─────────────────────────────────────────────────────────────────────────────

/** The bytes the fake canvases encode, and their base64. */
const ENCODED = new Uint8Array([1, 2, 3]);
const ENCODED_BASE64 = "AQID";

/** One drawImage call: the bitmap, then the target rectangle or the source and target rectangles. */
type Draw = readonly [bitmap: object, ...numbers: number[]];

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
  /** Whether getContext answers a context, and the type a blob ends up with (empty: the asked type). */
  static readonly setup = { hasContext: true, blobType: "" };
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

  async convertToBlob(options: { readonly type: string }): Promise<Blob> {
    this.options = options;
    const type =
      FakeOffscreenCanvas.setup.blobType === "" ? options.type : FakeOffscreenCanvas.setup.blobType;
    return new Blob([ENCODED], { type });
  }
}

/** The decoded bitmap the fake createImageBitmap answers. */
const bitmap = { width: 1080, height: 1920, close: vi.fn() };

/** The fake createImageBitmap; records the blob it decoded. */
const createImageBitmap = vi.fn(async (_blob: Blob) => bitmap);

/**
 * Stubs a page without OffscreenCanvas whose document makes one canvas element.
 *
 * @returns The element and its 2d context.
 */
function stubElement() {
  const context = fakeContext();
  const element = {
    width: 0,
    height: 0,
    getContext: (_type: "2d") => context,
    toDataURL: vi.fn((type: string, _quality?: number) => `data:${type};base64,ELEMENT`)
  };
  vi.stubGlobal("OffscreenCanvas", undefined);
  vi.stubGlobal("document", { createElement: (_tag: "canvas") => element });
  return { element, context };
}

beforeEach(() => {
  FakeOffscreenCanvas.made.length = 0;
  FakeOffscreenCanvas.setup.hasContext = true;
  FakeOffscreenCanvas.setup.blobType = "";
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

  it("png keeps the old path: draws on an OffscreenCanvas at the size and answers a PNG data URL", async () => {
    const picture = await decodePicture(PNG);

    const png = await picture.encode({
      size: { width: 540, height: 960 },
      format: "png",
      quality: 0.8
    });

    expect(png).toBe(`data:image/png;base64,${ENCODED_BASE64}`);
    const [canvas] = FakeOffscreenCanvas.made;
    expect(canvas).toMatchObject({ width: 540, height: 960, options: { type: "image/png" } });
    expect(canvas?.options).toEqual({ type: "image/png" });
    expect(canvas?.context.draws).toEqual([[bitmap, 0, 0, 540, 960]]);
    expect(canvas?.context.imageSmoothingQuality).toBe("high");
  });

  it("encodes a JPEG with the quality through convertToBlob", async () => {
    const picture = await decodePicture(PNG);

    const jpeg = await picture.encode({
      size: { width: 1080, height: 1920 },
      format: "jpeg",
      quality: 0.8
    });

    expect(jpeg).toBe(`data:image/jpeg;base64,${ENCODED_BASE64}`);
    expect(FakeOffscreenCanvas.made[0]?.options).toEqual({ type: "image/jpeg", quality: 0.8 });
  });

  it("answers the data URL in the type of the blob (a page without JPEG gives PNG)", async () => {
    FakeOffscreenCanvas.setup.blobType = "image/png";
    const picture = await decodePicture(PNG);

    const image = await picture.encode({
      size: { width: 10, height: 10 },
      format: "jpeg",
      quality: 0.5
    });

    expect(image).toBe(`data:image/png;base64,${ENCODED_BASE64}`);
  });

  it("draws only the crop of the picture, scaled to the size", async () => {
    const picture = await decodePicture(PNG);

    await picture.encode({
      crop: { x: 100, y: 200, width: 300, height: 150 },
      size: { width: 150, height: 75 },
      format: "jpeg",
      quality: 0.9
    });

    const [canvas] = FakeOffscreenCanvas.made;
    expect(canvas).toMatchObject({ width: 150, height: 75 });
    expect(canvas?.context.draws).toEqual([[bitmap, 100, 200, 300, 150, 0, 0, 150, 75]]);
  });

  it("frees the bitmap on close", async () => {
    const picture = await decodePicture(PNG);

    picture.close();

    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("png on a canvas element when the page has no OffscreenCanvas: toDataURL(type)", async () => {
    const { element, context } = stubElement();

    const picture = await decodePicture(PNG);
    const png = await picture.encode({
      size: { width: 270, height: 480 },
      format: "png",
      quality: 0.8
    });

    expect(png).toBe("data:image/png;base64,ELEMENT");
    expect(element).toMatchObject({ width: 270, height: 480 });
    expect(element.toDataURL).toHaveBeenCalledWith("image/png");
    expect(context.draws).toEqual([[bitmap, 0, 0, 270, 480]]);
  });

  it("jpeg on a canvas element: toDataURL(type, quality)", async () => {
    const { element } = stubElement();

    const picture = await decodePicture(PNG);
    await picture.encode({ size: { width: 270, height: 480 }, format: "jpeg", quality: 0.6 });

    expect(element.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.6);
  });

  it("rejects without a canvas in the page", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", undefined);
    const picture = await decodePicture(PNG);

    expect(
      await rejectionOf(
        picture.encode({ size: { width: 270, height: 480 }, format: "png", quality: 0.8 })
      )
    ).toMatchObject({
      message:
        "[moku-editor] editor.capture: no canvas in this page.\n  Encoding needs a browser page."
    });
  });

  it("rejects when the canvas has no 2d context", async () => {
    FakeOffscreenCanvas.setup.hasContext = false;
    const picture = await decodePicture(PNG);

    expect(
      await rejectionOf(
        picture.encode({ size: { width: 270, height: 480 }, format: "png", quality: 0.8 })
      )
    ).toMatchObject({
      message:
        "[moku-editor] editor.capture: the canvas has no 2d context.\n  Encoding needs a browser page."
    });
  });

  it("rejects without createImageBitmap", async () => {
    vi.stubGlobal("createImageBitmap", undefined);

    expect(await rejectionOf(decodePicture(PNG))).toMatchObject({
      message:
        "[moku-editor] editor.capture: no createImageBitmap in this page.\n  Encoding needs a browser page."
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
