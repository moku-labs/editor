/**
 * @file Writes the overlay's three Barlow faces and `src/plugins/overlay/fonts/faces.ts` (spec 08 §
 * Fonts; decision "Subset the overlay's Barlow faces to the printed glyphs"). Each face is the
 * fontsource Latin woff2 (`@fontsource/barlow`, `@fontsource/barlow-condensed`, SIL OFL 1.1)
 * subset with HarfBuzz (`subset-font`) to the glyphs the overlay prints, then written beside
 * `faces.ts`, which carries the bytes as base64 (a shadow root ignores `@font-face`, so they travel
 * inside the module) and the glyph set as `GLYPHS`. The tools page's device strip names the same
 * files (`workspace/styles/fonts.css`).
 *
 * The glyph set: printable ASCII U+0020–U+007E, plus every printable non-ASCII character written in
 * the sources that print in these faces (literal, or as a `\uXXXX` escape): the overlay
 * (`src/plugins/overlay`, tests excluded), the graph painter (`src/plugins/perf/graph`), perf's
 * cause words and why sentences (`src/plugins/perf/protocol`, `src/plugins/perf/records.ts`) and
 * the tools strip (`src/plugins/renderView/device`). On 2026-10-15 that is NBSP U+00A0 and
 * § ° ± · × – — … → − ≥. Text a game supplies (labels, paths, system names) outside the set falls
 * back to the stacks' next face. `fonts.test.ts` fails when a source gains a glyph `GLYPHS` lacks.
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
    "Barlow Condensed",
    600
  ],
  [
    "barlow-condensed-latin-500.woff2",
    "@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2",
    "Barlow Condensed",
    500
  ],
  [
    "barlow-latin-500.woff2",
    "@fontsource/barlow/files/barlow-latin-500-normal.woff2",
    "Barlow",
    500
  ]
] as const;

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
  for (let code = 0x20; code <= 0x7e; code += 1) glyphs.add(String.fromCodePoint(code));
  for (const text of texts) {
    for (const char of text) if (char > "~" && PRINTABLE.test(char)) glyphs.add(char);
    for (const match of text.matchAll(ESCAPE)) {
      const char = String.fromCodePoint(Number.parseInt(match[1] ?? "0", 16));
      if (PRINTABLE.test(char)) glyphs.add(char);
    }
  }
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
    let font: Uint8Array;
    try {
      font = await readFile(join(REPO, "node_modules", source));
    } catch {
      ui.error(
        `[moku-editor] overlay-fonts found no ${source}.\n  Install the devDependencies: bun install.`
      );
      return 1;
    }
    const subset = await subsetFont(font, glyphs, { targetFormat: "woff2" });
    await writeFile(join(FONT_DIR, file), subset);
    entries.push([family, weight, Buffer.from(subset).toString("base64")]);
    ui.info(`${file} · ${font.length} → ${subset.length} B`);
  }
  const text = moduleText(glyphs, entries);
  await writeFile(join(FONT_DIR, "faces.ts"), text);
  ui.info(`faces.ts · ${text.length} B · glyphs beyond ASCII: ${glyphs.slice(95)}`);
  return 0;
}

process.exitCode = await writeFaces();
