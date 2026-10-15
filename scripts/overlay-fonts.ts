/**
 * @file Writes the overlay's three Barlow faces and `src/plugins/overlay/fonts/faces.ts` (spec 08 §
 * Fonts; decision "Subset the overlay's Barlow faces to the printed glyphs"). Each face is the
 * fontsource Latin woff2 (`@fontsource/barlow`, `@fontsource/barlow-condensed`, SIL OFL 1.1)
 * subset with HarfBuzz (`subset-font`) to the glyphs the overlay prints, then written beside
 * `faces.ts`, which carries the bytes as base64 (a shadow root ignores `@font-face`, so they travel
 * inside the module) and the glyph set as `GLYPHS`. The tools page's device strip names the same
 * files (`workspace/styles/fonts.css`).
 *
 * The glyph set: printable ASCII U+0020–U+007E (BASE_RANGES), plus every printable non-ASCII character written in
 * the sources that print in these faces (literal, or as a `\uXXXX` escape): the overlay
 * (`src/plugins/overlay`, tests excluded), the graph painter (`src/plugins/perf/graph`), perf's
 * cause words and why sentences (`src/plugins/perf/protocol`, `src/plugins/perf/records.ts`) and
 * the tools strip (`src/plugins/renderView/device`). On 2026-10-15 that is NBSP U+00A0 and
 * § ° ± · × – — … → − ≥. Text a game supplies (labels, paths, system names) outside the set falls
 * back to the stacks' next face. The faces are registered under private families
 * ("Moku Overlay Barlow Condensed", "Moku Overlay Barlow"), so a game's own Barlow never draws from
 * this subset. `fonts.test.ts` fails when a source gains a glyph `GLYPHS` lacks.
 *
 * Run with `bun run fonts:overlay`. Output through the branded console (MC1).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { createBrandConsole } from "@moku-labs/common/cli";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const FONT_DIR = join(REPO, "src/plugins/overlay/fonts");
const ui = createBrandConsole();

/**
 * `subset-font`'s default export (the package ships no types).
 */
type SubsetFont = (
  font: Uint8Array,
  text: string,
  options: { readonly targetFormat: "woff2" }
) => Promise<Uint8Array>;

const subsetFont = createRequire(import.meta.url)("subset-font") as SubsetFont;

/**
 * The sources whose printed text is set in these faces.
 */
const SOURCES = [
  "src/plugins/overlay",
  "src/plugins/perf/graph",
  "src/plugins/perf/protocol",
  "src/plugins/perf/records.ts",
  "src/plugins/renderView/device"
] as const;

/**
 * The three faces, in the order of the table of spec 08 § Fonts: the written file, the fontsource
 * file it is cut from, family, weight.
 */
const FACES = [
  [
    "barlow-condensed-latin-600.woff2",
    "@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2",
    "Moku Overlay Barlow Condensed",
    600
  ],
  [
    "barlow-condensed-latin-500.woff2",
    "@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2",
    "Moku Overlay Barlow Condensed",
    500
  ],
  [
    "barlow-latin-500.woff2",
    "@fontsource/barlow/files/barlow-latin-500-normal.woff2",
    "Moku Overlay Barlow",
    500
  ]
] as const;

/**
 * The ranges every face holds whatever the sources print: printable ASCII. Full Latin-1
 * (U+00A0–U+00FF) was measured on 2026-10-15 at 126 481 B gzip for the dev agent bundle, over the
 * 120 000 B bound (113 299 B with this range), so accented Latin in a game's text falls back to the
 * stacks' next face.
 */
const BASE_RANGES = [[0x20, 0x7e]] as const;

/** Characters of BASE_RANGES (all printable): the glyph set's ASCII head. */
const ASCII_GLYPH_COUNT = BASE_RANGES.reduce((sum, [first, last]) => sum + last - first + 1, 0);

/** A character a face can draw: a letter, number, punctuation, symbol or space. */
const PRINTABLE = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]$/u;

/** A `\uXXXX` escape in a source. */
const ESCAPE = /\\u([\dA-Fa-f]{4})/g;

/**
 * Every `.ts` / `.tsx` file of a source path (a folder or one file), tests and `faces.ts` left out.
 *
 * @param path - A path of SOURCES, relative to the repo.
 * @returns Absolute file paths.
 * @example
 * ```ts
 * await sourceFiles("src/plugins/perf/records.ts"); // [".../src/plugins/perf/records.ts"]
 * ```
 */
async function sourceFiles(path: string): Promise<string[]> {
  if (/\.tsx?$/.test(path)) return [join(REPO, path)];
  const entries = await readdir(join(REPO, path), { recursive: true });
  return entries
    .filter(
      file => /\.tsx?$/.test(file) && !file.includes("__tests__") && !file.endsWith("faces.ts")
    )
    .map(file => join(REPO, path, file));
}

/**
 * True for a character past printable ASCII (after "~").
 *
 * @param char - One character.
 * @returns Whether it is beyond U+007E.
 * @example
 * ```ts
 * isBeyondAscii("×"); // true
 * ```
 */
function isBeyondAscii(char: string): boolean {
  return char > "~";
}

/**
 * Adds a character to the glyph set when a face can draw it.
 *
 * @param glyphs - The glyph set.
 * @param char - One character.
 */
function addIfPrintable(glyphs: Set<string>, char: string): void {
  if (PRINTABLE.test(char)) glyphs.add(char);
}

/**
 * The characters of a code point range, both ends included.
 *
 * @param range - The first and last code point.
 * @returns The characters.
 * @example
 * ```ts
 * charsOfRange([0x41, 0x43]); // ["A", "B", "C"]
 * ```
 */
function charsOfRange(range: readonly [number, number]): string[] {
  const [first, last] = range;
  return Array.from({ length: last - first + 1 }, (_, index) =>
    String.fromCodePoint(first + index)
  );
}

/**
 * The characters a source writes as `\uXXXX` escapes.
 *
 * @param text - The source text.
 * @returns The characters, in order.
 * @example
 * ```ts
 * escapedChars('const NBSP = "\\u00A0";'); // ["\u00A0"]
 * ```
 */
function escapedChars(text: string): string[] {
  return [...text.matchAll(ESCAPE)].map(match =>
    String.fromCodePoint(Number.parseInt(match[1] ?? "0", 16))
  );
}

/**
 * The glyph set: printable ASCII and every printable non-ASCII character of the texts (literal or
 * escaped), in code point order.
 *
 * @param texts - The source texts.
 * @returns The characters as one string.
 * @example
 * ```ts
 * glyphsOf(['const MINUS = "\\u2212";']).endsWith("−"); // true
 * ```
 */
function glyphsOf(texts: readonly string[]): string {
  const glyphs = new Set<string>();
  // The base ranges, whatever the sources print.
  for (const char of BASE_RANGES.flatMap(range => charsOfRange(range)))
    addIfPrintable(glyphs, char);
  // Every printable character beyond ASCII the sources write, literally or as a \uXXXX escape.
  for (const text of texts) {
    for (const char of [...text].filter(each => isBeyondAscii(each))) addIfPrintable(glyphs, char);
    for (const char of escapedChars(text)) addIfPrintable(glyphs, char);
  }
  // In code point order.
  return [...glyphs].toSorted((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)).join("");
}

/**
 * The generated module's text, formatted the way Biome formats it.
 *
 * @param glyphs - The glyph set.
 * @param entries - Family, weight and base64 of each face.
 * @returns The module source.
 * @example
 * ```ts
 * moduleText("AB", [["Barlow", 500, "d09GMg=="]]).includes('family: "Barlow"'); // true
 * ```
 */
function moduleText(
  glyphs: string,
  entries: readonly (readonly [string, number, string])[]
): string {
  const faces = entries
    .map(([family, weight, base64]) =>
      [
        "  {",
        `    family: "${family}",`,
        `    weight: ${weight},`,
        "    base64:",
        `      "${base64}"`,
        "  }"
      ].join("\n")
    )
    .join(",\n");
  return `/**
 * @file overlay plugin — the bundled Barlow faces as base64, the table \`fonts/register.ts\` reads,
 * and the glyphs they hold. Generated by scripts/overlay-fonts.ts from fonts/*.woff2. Do not edit.
 */
import type { FaceSource } from "../types";

/**
 * The characters the three faces hold (they are subset to the glyphs the overlay prints).
 */
export const GLYPHS =
  ${JSON.stringify(glyphs)};

/**
 * The faces to register, in the order of the table of spec 08 § Fonts.
 */
export const FACES: readonly FaceSource[] = [
${faces}
];
`;
}

/**
 * Reads a fontsource face from node_modules.
 *
 * @param source - The path under node_modules.
 * @returns The bytes, or undefined when the package is not installed.
 * @example
 * ```ts
 * await readFontsource("@fontsource/barlow/files/barlow-latin-500-normal.woff2"); // Uint8Array(22008)
 * ```
 */
async function readFontsource(source: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(join(REPO, "node_modules", source));
  } catch {
    return undefined;
  }
}

/**
 * Subsets the three faces, writes them and `faces.ts`.
 *
 * @returns The process exit code: 0 when written, 1 when a fontsource file is missing.
 * @example
 * ```ts
 * process.exitCode = await writeFaces();
 * ```
 */
async function writeFaces(): Promise<number> {
  const paths = (await Promise.all(SOURCES.map(path => sourceFiles(path)))).flat();
  const glyphs = glyphsOf(await Promise.all(paths.map(path => readFile(path, "utf8"))));
  const entries: (readonly [string, number, string])[] = [];
  for (const [file, source, family, weight] of FACES) {
    // Read the fontsource face; a missing devDependency stops the run.
    const font = await readFontsource(source);
    if (font === undefined) {
      ui.error(
        `[moku-editor] overlay-fonts found no ${source}.\n  Install the devDependencies: bun install.`
      );
      return 1;
    }
    // Subset it to the glyph set, write the woff2, keep its base64 for faces.ts.
    const subset = await subsetFont(font, glyphs, { targetFormat: "woff2" });
    await writeFile(join(FONT_DIR, file), subset);
    entries.push([family, weight, Buffer.from(subset).toString("base64")]);
    ui.info(`${file} · ${font.length} → ${subset.length} B`);
  }
  // Write faces.ts and name the glyphs beyond the ASCII head.
  const text = moduleText(glyphs, entries);
  await writeFile(join(FONT_DIR, "faces.ts"), text);
  ui.info(`faces.ts · ${text.length} B · glyphs beyond ASCII: ${glyphs.slice(ASCII_GLYPH_COUNT)}`);
  return 0;
}

process.exitCode = await writeFaces();
