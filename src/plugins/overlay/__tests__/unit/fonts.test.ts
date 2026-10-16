// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACES, GLYPHS } from "../../fonts/faces";
import { bytesOf, deleteFaces, registerFaces } from "../../fonts/register";
import { overlayCss } from "../../styles";
import { createOctx, started, stopped, type TestOctx } from "../helpers";

const FONT_DIR = path.join(process.cwd(), "src/plugins/overlay/fonts/");

/** The face files of the table of spec 08 § Fonts, by name. */
const FACE_FILES = [
  ["barlow-condensed-latin-600.woff2", "Moku Overlay Barlow Condensed", 600],
  ["barlow-condensed-latin-500.woff2", "Moku Overlay Barlow Condensed", 500],
  ["barlow-latin-500.woff2", "Moku Overlay Barlow", 500]
] as const;

/** A Latin-subset face is about 22 KB; a full Barlow face (every script) is about twice that. */
const SUBSET_FACE_MAX = 30_000;

/** The sources whose text is set in these faces (the SOURCES of scripts/overlay-fonts.ts). */
const PRINTING_SOURCES = [
  "src/plugins/overlay",
  "src/plugins/perf/graph",
  "src/plugins/perf/protocol",
  "src/plugins/perf/records.ts"
];

/** A character a face can draw. */
const PRINTABLE = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]$/u;

/**
 * The texts of the printing sources (tests and faces.ts left out).
 *
 * @returns The file texts.
 */
function printingTexts(): string[] {
  return PRINTING_SOURCES.flatMap(source => {
    const root = path.join(process.cwd(), source);
    const files = /\.tsx?$/.test(source)
      ? [root]
      : readdirSync(root, { recursive: true, encoding: "utf8" })
          .filter(
            file =>
              /\.tsx?$/.test(file) && !file.includes("__tests__") && !file.endsWith("faces.ts")
          )
          .map(file => path.join(root, file));
    return files.map(file => readFileSync(file, "utf8"));
  });
}

/**
 * The printable non-ASCII characters of a source text, literal or as a `\\uXXXX` escape.
 *
 * @param text - The source text.
 * @returns The characters.
 */
function printedChars(text: string): string[] {
  const literal = [...text].filter(char => char > "~" && PRINTABLE.test(char));
  const escaped = [...text.matchAll(/\\u([\dA-Fa-f]{4})/g)].map(match =>
    String.fromCodePoint(Number.parseInt(match[1] ?? "0", 16))
  );
  return [...literal, ...escaped.filter(char => PRINTABLE.test(char))];
}

/** A FontFace stand-in that records what it was given and loads at once. */
class FakeFace {
  static readonly made: FakeFace[] = [];
  readonly loads: number[] = [];
  constructor(
    readonly family: string,
    readonly bytes: Uint8Array,
    readonly descriptors: Record<string, string>
  ) {
    FakeFace.made.push(this);
  }
  async load(): Promise<FakeFace> {
    this.loads.push(1);
    return this;
  }
}

/**
 * Gives the document a font set that records adds and deletes.
 *
 * @returns The set.
 */
function fontSet() {
  const set = { added: [] as unknown[], deleted: [] as unknown[] };
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      add: (face: unknown) => set.added.push(face),
      delete: (face: unknown) => set.deleted.push(face)
    }
  });
  return set;
}

let octx: TestOctx | undefined;

afterEach(() => {
  if (octx !== undefined) stopped(octx);
  octx = undefined;
  FakeFace.made.length = 0;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
});

describe("the bundled faces", () => {
  it("`faces.ts` is stale against the woff2 files (regenerate with bun scripts/overlay-fonts.ts)", () => {
    expect(FACES.map(face => [face.family, face.weight, face.base64])).toEqual(
      FACE_FILES.map(([name, family, weight]) => [
        family,
        weight,
        readFileSync(`${FONT_DIR}${name}`).toString("base64")
      ])
    );
  });

  it("a full (non-subset) face slipped in (each face is a Latin subset)", () => {
    for (const [name] of FACE_FILES) {
      expect(statSync(`${FONT_DIR}${name}`).size, name).toBeLessThanOrEqual(SUBSET_FACE_MAX);
    }
  });

  it("the three faces fit the spec 08 budget: 60 000 bytes of woff2, 82 000 bytes of faces.ts", () => {
    const total = FACE_FILES.reduce((sum, [name]) => sum + statSync(`${FONT_DIR}${name}`).size, 0);
    expect(total).toBeLessThanOrEqual(60_000);
    expect(statSync(`${FONT_DIR}faces.ts`).size).toBeLessThanOrEqual(82_000);
  });

  it("the folder holds exactly the three faces, and the tools page loads none of them (spec 09 Delta 2026-10-15: the page is set in Geist)", () => {
    expect(readdirSync(FONT_DIR).toSorted()).toEqual(
      [...FACE_FILES.map(([name]) => name), "OFL.txt", "faces.ts", "register.ts"].toSorted()
    );
    const css = readFileSync(
      path.join(process.cwd(), "src/plugins/workspace/styles/fonts.css"),
      "utf8"
    );
    for (const [name, family] of FACE_FILES) {
      expect(css).not.toContain(name);
      expect(css).not.toContain(family);
    }
    expect(css.toLowerCase()).not.toContain("barlow");
  });

  it("a new glyph silently falls back (every character the overlay prints is in the subset)", () => {
    const ascii = Array.from({ length: 0x5f }, (_, index) => String.fromCodePoint(0x20 + index));
    const printed = [...ascii, ...printingTexts().flatMap(text => printedChars(text))];
    expect([...new Set(printed.filter(char => !GLYPHS.includes(char)))]).toEqual([]);
  });

  it("a game's own Barlow is drawn from our subset (the faces and the sheet use private families)", () => {
    expect(new Set(FACES.map(face => face.family))).toEqual(
      new Set(["Moku Overlay Barlow Condensed", "Moku Overlay Barlow"])
    );
    expect(overlayCss).toContain(
      '--font-cond: "Moku Overlay Barlow Condensed", "Barlow Condensed",'
    );
    expect(overlayCss).toContain('--font-text: "Moku Overlay Barlow", Barlow,');
    expect(overlayCss).not.toMatch(/font(-family)?:[^;]*(^|[\s,])"?Barlow( Condensed)?"?[,;]/m);
  });

  it("decodes base64 into the woff2 bytes", () => {
    expect([...bytesOf("d09GMg==")]).toEqual([119, 79, 70, 50]);
  });
});

describe("registerFaces", () => {
  it("registers each face with document.fonts at the first visible mode, once", async () => {
    vi.stubGlobal("FontFace", FakeFace);
    const set = fontSet();
    octx = started(createOctx({ remember: false }));
    const faces = [{ family: "Barlow Condensed", weight: 600, base64: "d09GMg==" }];
    registerFaces(octx, faces);
    registerFaces(octx, faces);
    expect(FakeFace.made).toHaveLength(1);
    expect(FakeFace.made[0]).toMatchObject({
      family: "Barlow Condensed",
      descriptors: { weight: "600", style: "normal", display: "swap" }
    });
    expect(set.added).toEqual(FakeFace.made);
    octx.state.graph = octx.graph.createState(8);
    octx.state.painted.version = 7;
    await vi.waitFor(() => {
      expect(octx?.graph.resetText).toHaveBeenCalledTimes(1);
    });
    expect(octx.state.painted.version).toBe(-1);
  });

  it("stop leaves the faces in document.fonts (it deletes them)", () => {
    vi.stubGlobal("FontFace", FakeFace);
    const set = fontSet();
    const made = started(createOctx({ remember: false }));
    registerFaces(made, [{ family: "Barlow", weight: 500, base64: "d09GMg==" }]);
    stopped(made);
    expect(set.deleted).toEqual(FakeFace.made);
    expect(made.state.faces).toBeUndefined();
    deleteFaces(made.state);
  });

  it("a missing FontFace throws at start (it skips and logs debug)", () => {
    vi.stubGlobal("FontFace", undefined);
    octx = started(createOctx({ mode: "card", remember: false }));
    expect(octx.state.faces).toEqual([]);
    expect(octx.log.debug).toHaveBeenCalledWith("overlay:fonts-unavailable");
  });
});
