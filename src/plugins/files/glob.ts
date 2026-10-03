/**
 * @file files plugin — the glob dialect of `allow` and `deny`, compiled to an anchored RegExp.
 * `**\/` = zero or more whole segments, a trailing `/**` = the folder itself or anything below,
 * `**` elsewhere = anything, `*` = one segment's characters, `?` = one character, `{a,b}` =
 * alternation (no nesting). Dot files match like any name. Pure, no dependency.
 */

/**
 * Characters escaped when they stand for themselves.
 */
const SPECIAL = new Set([
  "\\",
  "^",
  "$",
  ".",
  "|",
  "+",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "*",
  "?",
  "/"
]);

/**
 * Escapes one literal character for a RegExp source.
 *
 * @param char - One character of the pattern.
 * @returns The RegExp source that matches it literally.
 * @example
 * ```ts
 * literal("."); // "\\."
 * ```
 */
function literal(char: string): string {
  return SPECIAL.has(char) ? `\\${char}` : char;
}

/**
 * Translates the star run that starts at `index`.
 *
 * @param pattern - The whole pattern.
 * @param index - Index of the first `*`.
 * @returns The RegExp source and how many pattern characters it consumed.
 * @example
 * ```ts
 * stars("**\/*.ts", 0); // { source: "(?:[^/]+/)*", length: 3 }
 * ```
 */
function stars(pattern: string, index: number): { source: string; length: number } {
  if (pattern[index + 1] !== "*") return { source: "[^/]*", length: 1 };

  const atSegmentStart = index === 0 || pattern[index - 1] === "/";
  if (atSegmentStart && pattern[index + 2] === "/") {
    return { source: "(?:[^/]+/)*", length: 3 };
  }

  return { source: ".*", length: 2 };
}

/**
 * One translated character and the brace state after it.
 */
type Step = { readonly source: string; readonly inBrace: boolean };

/**
 * Translates one character that is not a star: `?`, the brace syntax or a literal.
 *
 * @param char - The character.
 * @param inBrace - Whether an alternation is open.
 * @param closes - Whether a `}` follows somewhere (an unclosed `{` is literal).
 * @returns The RegExp source and the new brace state.
 * @example
 * ```ts
 * translate("{", false, true); // { source: "(?:", inBrace: true }
 * ```
 */
function translate(char: string, inBrace: boolean, closes: boolean): Step {
  if (char === "{" && !inBrace && closes) return { source: "(?:", inBrace: true };
  if (char === "," && inBrace) return { source: "|", inBrace };
  if (char === "}" && inBrace) return { source: ")", inBrace: false };

  return { source: char === "?" ? "[^/]" : literal(char), inBrace };
}

/**
 * Compiles one glob into an anchored RegExp (`^…$`).
 *
 * @param pattern - A glob relative to the root, posix separators.
 * @param options - Matching options.
 * @param options.caseInsensitive - Adds the `i` flag (used for deny).
 * @returns The compiled expression.
 * @example
 * ```ts
 * compileGlob("**\/*.ts", { caseInsensitive: false }).test("src/a.ts"); // true
 * compileGlob(".moku/**", { caseInsensitive: false }).test(".moku"); // true
 * ```
 */
export function compileGlob(
  pattern: string,
  options: { readonly caseInsensitive: boolean }
): RegExp {
  let source = "";
  let inBrace = false;
  let index = 0;

  while (index < pattern.length) {
    const char = pattern.charAt(index);

    if (char === "/" && index === pattern.length - 3 && pattern.endsWith("/**")) {
      source += "(?:/.*)?";
      break;
    }

    if (char === "*") {
      const run = stars(pattern, index);
      source += run.source;
      index += run.length;
      continue;
    }

    const step = translate(char, inBrace, pattern.includes("}", index));
    source += step.source;
    inBrace = step.inBrace;
    index += 1;
  }

  return new RegExp(`^${source}$`, options.caseInsensitive ? "i" : "");
}
