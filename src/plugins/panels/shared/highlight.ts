/**
 * @file Shared view module — the one syntax highlighter of the tools page: hand-written TS/TSX,
 * CSS, JSON and Markdown scanners emitting `<span data-token="<kind>">` VNodes (no innerHTML, no
 * class). Colours come from the workspace `[data-token]` atoms and `--code-*` tokens.
 *
 * Every scanner works line by line on a cursor and carries what spans lines (block comments,
 * template literals, open TSX tags, CSS braces, Markdown front matter and fences) in a small
 * state object. A scanner step either consumes at least one character or the loop emits the
 * character as `plain`, so a scanner never loops forever and never throws.
 */
import type { ComponentChildren } from "preact";
import { h } from "preact";

/**
 * A highlighter language.
 *
 * @example
 * ```ts
 * const lang: Lang = langOf("nodes/merge.ts"); // "script"
 * ```
 */
export type Lang = "script" | "css" | "json" | "markdown" | "plain";

/**
 * A token kind (one `--code-<kind>` token each).
 *
 * @example
 * ```ts
 * const kind: TokenKind = "keyword";
 * ```
 */
export type TokenKind =
  | "plain"
  | "keyword"
  | "literal"
  | "string"
  | "number"
  | "comment"
  | "type"
  | "function"
  | "property"
  | "tag"
  | "attr"
  | "punct"
  | "operator"
  | "meta"
  | "heading";

/**
 * One token of a line.
 *
 * @example
 * ```ts
 * const token: Token = { text: "const", kind: "keyword" };
 * ```
 */
export type Token = { readonly text: string; readonly kind: TokenKind };

// ─── The cursor shared by every scanner ──────────────────────────────────────

/** One line being scanned: the text, the position, the tokens so far and the last significant one. */
type Cursor = {
  readonly line: string;
  pos: number;
  readonly tokens: Token[];
  /** The last significant (not blank, not comment) token of this line; undefined at line start. */
  prev: Token | undefined;
};

/** A scanner step: consumes from the cursor and returns true, or leaves it and returns false. */
type Step<S> = (cursor: Cursor, state: S) => boolean;

/** Blanks: spaces and tabs. */
const BLANK = /[ \t]+/y;

/**
 * Creates a cursor at the start of a line.
 *
 * @param line - The line.
 * @returns The cursor.
 * @example
 * ```ts
 * const cursor = cursorOf("const a = 1;"); // pos 0, no tokens
 * ```
 */
function cursorOf(line: string): Cursor {
  return { line, pos: 0, tokens: [], prev: undefined };
}

/**
 * Appends a token, merging it into the last one when the kinds match; empty texts are skipped.
 *
 * @param tokens - The tokens of the line.
 * @param kind - The kind.
 * @param text - The text.
 * @example
 * ```ts
 * push(tokens, "plain", " "); push(tokens, "plain", " "); // one token "  "
 * ```
 */
function push(tokens: Token[], kind: TokenKind, text: string): void {
  if (text === "") return;

  const last = tokens.at(-1);
  if (last?.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
  else tokens.push({ kind, text });
}

/**
 * Emits a text at the cursor and moves past it; plain blanks and comments are not significant.
 *
 * @param cursor - The cursor.
 * @param kind - The kind.
 * @param text - The text, which starts at the cursor.
 * @param significant - Whether the token becomes `prev`.
 * @returns Always true, so a step can return it.
 * @example
 * ```ts
 * emit(cursor, "keyword", "const"); // cursor.pos += 5, prev is the keyword
 * ```
 */
function emit(cursor: Cursor, kind: TokenKind, text: string, significant = true): boolean {
  push(cursor.tokens, kind, text);
  cursor.pos += text.length;
  if (significant && text !== "") cursor.prev = { kind, text };
  return true;
}

/**
 * Matches a sticky regex at the cursor.
 *
 * @param cursor - The cursor.
 * @param pattern - A sticky (`y`) regex.
 * @returns The matched text, or undefined.
 * @example
 * ```ts
 * matchAt(cursorOf("  a"), BLANK); // "  "
 * ```
 */
function matchAt(cursor: Cursor, pattern: RegExp): string | undefined {
  pattern.lastIndex = cursor.pos;
  return pattern.exec(cursor.line)?.[0];
}

/**
 * Tells whether a sticky regex matches at a position.
 *
 * @param line - The line.
 * @param position - Where to test.
 * @param pattern - A sticky (`y`) regex.
 * @returns True on a match.
 * @example
 * ```ts
 * testAt("f (x)", 1, CALL_AHEAD); // true
 * ```
 */
function testAt(line: string, position: number, pattern: RegExp): boolean {
  pattern.lastIndex = position;
  return pattern.test(line);
}

/**
 * Runs the steps of a scanner over one line until it ends.
 *
 * @param line - The line.
 * @param state - The scanner state carried across lines.
 * @param pick - Picks the steps for the current state (they may depend on a mode).
 * @returns The tokens of the line.
 */
function scan<S>(line: string, state: S, pick: (state: S) => readonly Step<S>[]): Token[] {
  const cursor = cursorOf(line);

  while (cursor.pos < line.length) {
    const steps = pick(state);
    if (!steps.some(step => step(cursor, state))) emit(cursor, "plain", line.charAt(cursor.pos));
  }

  return cursor.tokens;
}

/**
 * Emits a run of blanks.
 *
 * @param cursor - The cursor.
 * @returns True when there were blanks.
 * @example
 * ```ts
 * blankStep(cursorOf("  a")); // true, emits plain "  "
 * ```
 */
function blankStep(cursor: Cursor): boolean {
  const blank = matchAt(cursor, BLANK);
  return blank !== undefined && emit(cursor, "plain", blank, false);
}

/**
 * Emits a quoted string up to its unescaped closing quote or the line end.
 *
 * @param cursor - The cursor, on the opening quote.
 * @returns True when the cursor was on a quote.
 * @example
 * ```ts
 * quotedStep(cursorOf(String.raw`"a\"b" + c`)); // emits string "a\"b"
 * ```
 */
function quotedStep(cursor: Cursor): boolean {
  const { line, pos } = cursor;
  const quote = line.charAt(pos);
  if (quote !== '"' && quote !== "'") return false;

  let index = pos + 1;
  while (index < line.length && line.charAt(index) !== quote) {
    index += line.charAt(index) === "\\" ? 2 : 1;
  }
  return emit(cursor, "string", line.slice(pos, Math.min(index + 1, line.length)));
}

/** A state that can be inside a block comment. */
type CommentState = { comment: boolean };

/**
 * Emits a block comment from the cursor up to its closing `*\/` or the line end.
 *
 * @param cursor - The cursor.
 * @param state - The state; set while the comment stays open.
 * @param from - Where to look for the closing marker.
 * @returns Always true.
 */
function emitComment(cursor: Cursor, state: CommentState, from: number): boolean {
  const end = cursor.line.indexOf("*/", from);
  state.comment = end === -1;
  const text = cursor.line.slice(cursor.pos, end === -1 ? undefined : end + 2);
  return emit(cursor, "comment", text, false);
}

/**
 * Emits a block comment opening at the cursor (`/*`), possibly left open at the line end.
 *
 * @param cursor - The cursor.
 * @param state - The state; set when the comment stays open.
 * @returns True when a block comment opens here.
 */
function blockCommentStep(cursor: Cursor, state: CommentState): boolean {
  return cursor.line.startsWith("/*", cursor.pos) && emitComment(cursor, state, cursor.pos + 2);
}

/**
 * Continues a block comment carried from an earlier line, up to its end or the line end.
 *
 * @param cursor - The cursor.
 * @param state - The state.
 * @returns True while inside a comment carried from an earlier line.
 */
function openCommentStep(cursor: Cursor, state: CommentState): boolean {
  return state.comment && emitComment(cursor, state, cursor.pos);
}

// ─── script (TS, TSX, JS) ────────────────────────────────────────────────────

/** The TS reserved and contextual keywords. */
const KEYWORDS: ReadonlySet<string> = new Set(
  (
    "const let var function return if else for while do switch case break continue new class " +
    "extends implements interface type enum import export from as default async await yield try " +
    "catch finally throw typeof instanceof in of keyof readonly declare namespace satisfies void delete"
  ).split(" ")
);

/** The literal words. */
const LITERALS: ReadonlySet<string> = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "super"
]);

/** What may stand before a TSX `<` that opens a tag. */
const BEFORE_TAG: ReadonlySet<string> = new Set([
  "(",
  ",",
  "=",
  ":",
  "?",
  "{",
  "return",
  "&&",
  "||",
  "=>"
]);

/** Punctuation that ends an expression, so a `/` after it divides. */
const CLOSERS: ReadonlySet<string> = new Set([")", "]", "}"]);

/** An identifier. */
const IDENTIFIER = /[\p{ID_Start}_$][\p{ID_Continue}$‌‍]*/uy;
/** A hex, binary or octal literal, with an optional bigint suffix. */
const RADIX_NUMBER = /0(?:[xX][\da-fA-F_]+|[bB][01_]+|[oO][0-7_]+)n?/y;
/** A decimal literal with separators, fraction, exponent and an optional bigint suffix. */
const DECIMAL_NUMBER = /\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d[\d_]*)?n?/y;
/** A fraction without its leading zero, with an optional exponent. */
const FRACTION_NUMBER = /\.\d[\d_]*(?:[eE][+-]?\d[\d_]*)?/y;
/** The operators longer than one character, by length, longest first. */
const LONG_OPERATORS: readonly ReadonlySet<string>[] = [
  new Set([">>>="]),
  new Set(["...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??="]),
  new Set(["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/="]),
  new Set(["%=", "&=", "|=", "^=", "**", "<<", ">>"])
];
/** The lengths of LONG_OPERATORS, in the same order. */
const LONG_OPERATOR_LENGTHS = [4, 3, 2, 2] as const;
/** The one-character operators. */
const SHORT_OPERATORS = "+-*/%=<>!&|^~?:@#";
/** Optional chaining (not `? .5`). */
const OPTIONAL_CHAIN = /\?\.(?!\d)/y;
/** Punctuation other than braces. */
const PUNCT = /[()[\];,.]/y;
/** Optional blanks and an opening parenthesis: a call. */
const CALL_AHEAD = /[ \t]*\(/y;
/** An optional `?`, optional blanks and a colon (not `::`): a member name. */
const MEMBER_AHEAD = /\??[ \t]*:(?!:)/y;
/** Regex flags. */
const FLAGS = /[a-z]*/y;
/** A TSX tag opening: `<Name`, `</Name`, `<` of a fragment. */
const TAG_OPEN = /<\/?(?:[A-Za-z][\w.:-]*)?/y;
/** A TSX attribute name. */
const ATTRIBUTE = /[A-Za-z_$][\w$:-]*/y;
/** An upper-case first letter. */
const UPPER_FIRST = /^[A-Z]/;

/** One frame of the script mode stack. */
type Frame =
  | { readonly mode: "template" }
  | { readonly mode: "tag" }
  | { readonly mode: "code"; depth: number };

/** What the script scanner carries across lines. */
type ScriptState = { comment: boolean; readonly stack: Frame[] };

/**
 * The kind of an identifier from its neighbours.
 *
 * @param cursor - The cursor, on the identifier.
 * @param word - The identifier.
 * @returns The kind.
 * @example
 * ```ts
 * identifierKind(cursorOf("build(input)"), "build"); // "function"
 * ```
 */
function identifierKind(cursor: Cursor, word: string): TokenKind {
  const end = cursor.pos + word.length;
  const previous = cursor.prev?.text;
  const call = testAt(cursor.line, end, CALL_AHEAD);

  if (previous === "." || previous === "?.") return call ? "function" : "property";
  if (KEYWORDS.has(word)) return "keyword";
  if (LITERALS.has(word)) return "literal";
  if (call) return "function";
  if (UPPER_FIRST.test(word)) return "type";

  const memberPlace = previous === undefined || previous === "{" || previous === ",";
  return memberPlace && testAt(cursor.line, end, MEMBER_AHEAD) ? "property" : "plain";
}

/**
 * Emits an identifier with its kind.
 *
 * @param cursor - The cursor.
 * @returns True on an identifier.
 * @example
 * ```ts
 * identifierStep(cursorOf("const a")); // emits keyword "const"
 * ```
 */
function identifierStep(cursor: Cursor): boolean {
  const word = matchAt(cursor, IDENTIFIER);
  return word !== undefined && emit(cursor, identifierKind(cursor, word), word);
}

/**
 * Emits a number.
 *
 * @param cursor - The cursor.
 * @returns True on a number.
 * @example
 * ```ts
 * numberStep(cursorOf("1_000n + 2")); // emits number "1_000n"
 * ```
 */
function numberStep(cursor: Cursor): boolean {
  const char = cursor.line.charAt(cursor.pos);
  if (!(char >= "0" && char <= "9") && char !== ".") return false;

  const number =
    matchAt(cursor, RADIX_NUMBER) ??
    matchAt(cursor, DECIMAL_NUMBER) ??
    matchAt(cursor, FRACTION_NUMBER);
  return number !== undefined && emit(cursor, "number", number);
}

/**
 * Emits a line comment.
 *
 * @param cursor - The cursor.
 * @returns True on `//`.
 * @example
 * ```ts
 * lineCommentStep(cursorOf("// note")); // emits comment "// note"
 * ```
 */
function lineCommentStep(cursor: Cursor): boolean {
  return (
    cursor.line.startsWith("//", cursor.pos) &&
    emit(cursor, "comment", cursor.line.slice(cursor.pos), false)
  );
}

/**
 * Tells whether a `/` may start a regex, from the previous significant token.
 *
 * @param previous - The previous significant token.
 * @returns True when a regex may start.
 * @example
 * ```ts
 * regexMayStart({ text: "=", kind: "operator" }); // true
 * ```
 */
function regexMayStart(previous: Token | undefined): boolean {
  if (previous === undefined) return true;
  if (previous.kind === "operator" || previous.kind === "keyword") return true;
  return previous.kind === "punct" && !CLOSERS.has(previous.text);
}

/**
 * The end of a regex body starting at a `/`.
 *
 * @param line - The line.
 * @param start - The index of the opening `/`.
 * @returns The index after the closing slash, or -1 when the line ends first.
 * @example
 * ```ts
 * regexEnd("/[/]+/g", 0); // 6
 * ```
 */
function regexEnd(line: string, start: number): number {
  let inClass = false;
  for (let index = start + 1; index < line.length; index += 1) {
    switch (line.charAt(index)) {
      case "\\": {
        index += 1;
        break;
      }
      case "[": {
        inClass = true;
        break;
      }
      case "]": {
        inClass = false;
        break;
      }
      case "/": {
        if (!inClass) return index + 1;
        break;
      }
      // No default: any other character is part of the body.
    }
  }
  return -1;
}

/**
 * Emits a regex literal with its flags.
 *
 * @param cursor - The cursor.
 * @returns True on a regex.
 * @example
 * ```ts
 * regexStep(cursorOf("/a+/g.test(s)")); // emits string "/a+/g"
 * ```
 */
function regexStep(cursor: Cursor): boolean {
  if (cursor.line.charAt(cursor.pos) !== "/" || !regexMayStart(cursor.prev)) return false;

  const end = regexEnd(cursor.line, cursor.pos);
  if (end === -1) return false;

  FLAGS.lastIndex = end;
  const flags = FLAGS.exec(cursor.line)?.[0] ?? "";
  return emit(cursor, "string", cursor.line.slice(cursor.pos, end + flags.length));
}

/**
 * Tells whether a `<` at the cursor opens a TSX tag.
 *
 * @param cursor - The cursor, on `<`.
 * @param text - The matched `<`, `</`, `<Name` or `</Name`.
 * @returns True for a tag.
 * @example
 * ```ts
 * opensTag(cursorOf("<Row key"), "<Row"); // true at line start
 * ```
 */
function opensTag(cursor: Cursor, text: string): boolean {
  const closing = text.startsWith("</");
  const hasName = text.length > (closing ? 2 : 1);
  if (!hasName && cursor.line.charAt(cursor.pos + text.length) !== ">") return false;
  if (closing) return true;

  const previous = cursor.prev;
  return previous === undefined || previous.kind === "tag" || BEFORE_TAG.has(previous.text);
}

/**
 * Emits a TSX tag opening and enters tag mode.
 *
 * @param cursor - The cursor.
 * @param state - The script state.
 * @returns True on a tag.
 */
function tagOpenStep(cursor: Cursor, state: ScriptState): boolean {
  if (cursor.line.charAt(cursor.pos) !== "<") return false;

  const text = matchAt(cursor, TAG_OPEN);
  if (text === undefined || !opensTag(cursor, text)) return false;

  state.stack.push({ mode: "tag" });
  return emit(cursor, "tag", text);
}

/**
 * Emits a template opening backtick and enters template mode.
 *
 * @param cursor - The cursor.
 * @param state - The script state.
 * @returns True on a backtick.
 */
function templateOpenStep(cursor: Cursor, state: ScriptState): boolean {
  if (cursor.line.charAt(cursor.pos) !== "`") return false;

  state.stack.push({ mode: "template" });
  return emit(cursor, "string", "`");
}

/**
 * Emits a brace, counting depth inside a `${…}` or a TSX `{…}` and leaving it at its end.
 *
 * @param cursor - The cursor.
 * @param state - The script state.
 * @returns True on a brace.
 */
function braceStep(cursor: Cursor, state: ScriptState): boolean {
  const char = cursor.line.charAt(cursor.pos);
  if (char !== "{" && char !== "}") return false;

  const top = state.stack.at(-1);
  if (top?.mode === "code") {
    top.depth += char === "{" ? 1 : -1;
    if (top.depth === 0) state.stack.pop();
  }
  return emit(cursor, "punct", char);
}

/**
 * The operator at a position, longest first.
 *
 * @param line - The line.
 * @param position - Where to look.
 * @returns The operator, or undefined.
 * @example
 * ```ts
 * operatorAt("a ??= b", 2); // "??="
 * ```
 */
function operatorAt(line: string, position: number): string | undefined {
  for (const [index, operators] of LONG_OPERATORS.entries()) {
    const text = line.slice(position, position + (LONG_OPERATOR_LENGTHS[index] ?? 1));
    if (operators.has(text)) return text;
  }
  const char = line.charAt(position);
  return char !== "" && SHORT_OPERATORS.includes(char) ? char : undefined;
}

/**
 * Emits optional chaining, an operator or punctuation.
 *
 * @param cursor - The cursor.
 * @returns True on one of them.
 * @example
 * ```ts
 * symbolStep(cursorOf("?.x")); // emits punct "?."
 * ```
 */
function symbolStep(cursor: Cursor): boolean {
  const chain = matchAt(cursor, OPTIONAL_CHAIN);
  if (chain !== undefined) return emit(cursor, "punct", chain);

  const operator = operatorAt(cursor.line, cursor.pos);
  if (operator !== undefined) return emit(cursor, "operator", operator);

  const punct = matchAt(cursor, PUNCT);
  return punct !== undefined && emit(cursor, "punct", punct);
}

/**
 * Emits template text up to the closing backtick, a `${` or the line end.
 *
 * @param cursor - The cursor, inside template text.
 * @param state - The script state.
 * @returns Always true.
 */
function templateTextStep(cursor: Cursor, state: ScriptState): boolean {
  const { line, pos } = cursor;
  let index = pos;

  while (index < line.length) {
    const char = line.charAt(index);
    if (char === "\\") index += 2;
    else if (char === "`") {
      state.stack.pop();
      return emit(cursor, "string", line.slice(pos, index + 1));
    } else if (char === "$" && line.charAt(index + 1) === "{") {
      emit(cursor, "string", line.slice(pos, index));
      state.stack.push({ mode: "code", depth: 1 });
      return emit(cursor, "punct", "${");
    } else index += 1;
  }
  return emit(cursor, "string", line.slice(pos));
}

/**
 * Inside a TSX tag: attributes, values, `{…}` expressions and the tag end.
 *
 * @param cursor - The cursor, inside a tag.
 * @param state - The script state.
 * @returns True when something was consumed.
 */
function tagStep(cursor: Cursor, state: ScriptState): boolean {
  const { line, pos } = cursor;
  const char = line.charAt(pos);

  if (char === ">" || line.startsWith("/>", pos)) {
    state.stack.pop();
    return emit(cursor, "tag", char === ">" ? ">" : "/>");
  }
  if (char === "{") {
    state.stack.push({ mode: "code", depth: 1 });
    return emit(cursor, "punct", "{");
  }
  if (char === "=") return emit(cursor, "operator", "=");

  const name = matchAt(cursor, ATTRIBUTE);
  return name === undefined ? quotedStep(cursor) : emit(cursor, "attr", name);
}

/** The code steps, in order. */
const CODE_STEPS: readonly Step<ScriptState>[] = [
  openCommentStep,
  blankStep,
  lineCommentStep,
  blockCommentStep,
  quotedStep,
  templateOpenStep,
  numberStep,
  identifierStep,
  regexStep,
  tagOpenStep,
  braceStep,
  symbolStep
];

/** The steps inside template text. */
const TEMPLATE_STEPS: readonly Step<ScriptState>[] = [templateTextStep];

/** The steps inside a TSX tag. */
const TAG_STEPS: readonly Step<ScriptState>[] = [blankStep, tagStep];

/**
 * The steps for the current script mode.
 *
 * @param state - The script state.
 * @returns The steps.
 */
function scriptSteps(state: ScriptState): readonly Step<ScriptState>[] {
  const mode = state.stack.at(-1)?.mode ?? "code";
  if (mode === "template") return TEMPLATE_STEPS;
  return mode === "tag" ? TAG_STEPS : CODE_STEPS;
}

/**
 * A script line scanner with its state.
 *
 * @returns The scanner.
 * @example
 * ```ts
 * const scanLine = scriptScanner(); scanLine("const t = `a"); scanLine("b`;");
 * ```
 */
function scriptScanner(): (line: string) => Token[] {
  const state: ScriptState = { comment: false, stack: [] };
  return line => scan(line, state, scriptSteps);
}

// ─── css ─────────────────────────────────────────────────────────────────────

/** Where the CSS scanner is inside a statement. */
type CssMode = "start" | "selector" | "prelude" | "property" | "value";

/** What the CSS scanner carries across lines. */
type CssState = { comment: boolean; depth: number; mode: CssMode };

/** An at-rule keyword. */
const AT_RULE = /@[\w-]+/y;
/** A CSS identifier (custom properties included). */
const CSS_IDENTIFIER = /-{0,2}[A-Za-z_][\w-]*/y;
/** A number with its unit. */
const CSS_NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[A-Za-z%]+)?/y;
/** A hex colour. */
const CSS_HEX = /#[\da-fA-F]{3,8}(?![\w-])/y;
/** `!important` and the like. */
const CSS_BANG = /![A-Za-z]+/y;
/** A run of selector text. */
const SELECTOR_RUN = /(?:[^\s,{}"';/]|\/(?!\*))+/y;
/** Punctuation inside values and preludes. */
const CSS_PUNCT = /[:,()/]/y;

/**
 * Tells whether the statement at a position (inside braces) is a nested rule: a `{` comes
 * before any `;` or `}` on the line, strings skipped.
 *
 * @param line - The line.
 * @param from - Where the statement starts.
 * @returns True for a selector.
 * @example
 * ```ts
 * nestedRuleAhead("&:hover { color: red }", 0); // true
 * ```
 */
function nestedRuleAhead(line: string, from: number): boolean {
  let quote = "";
  for (let index = from; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (quote !== "") {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    switch (char) {
      case '"':
      case "'": {
        quote = char;
        break;
      }
      case "{": {
        return true;
      }
      case ";":
      case "}": {
        return false;
      }
      // No default: any other character is part of the statement.
    }
  }
  return false;
}

/**
 * Emits a brace or semicolon and resets the statement.
 *
 * @param cursor - The cursor.
 * @param state - The CSS state.
 * @returns True on `{`, `}` or `;`.
 */
function cssStructureStep(cursor: Cursor, state: CssState): boolean {
  const char = cursor.line.charAt(cursor.pos);
  if (char !== "{" && char !== "}" && char !== ";") return false;

  if (char === "{") state.depth += 1;
  if (char === "}") state.depth = Math.max(0, state.depth - 1);
  state.mode = "start";
  return emit(cursor, "punct", char);
}

/**
 * What a new statement is: an at-rule prelude, a selector or a declaration.
 *
 * @param cursor - The cursor, on the first character of the statement.
 * @param state - The CSS state.
 * @returns The mode of the statement.
 */
function statementMode(cursor: Cursor, state: CssState): CssMode {
  if (cursor.line.charAt(cursor.pos) === "@") return "prelude";
  return state.depth === 0 || nestedRuleAhead(cursor.line, cursor.pos) ? "selector" : "property";
}

/**
 * Selector text: tags, strings and commas.
 *
 * @param cursor - The cursor.
 * @param state - The CSS state.
 * @returns True when something was consumed.
 */
function selectorStep(cursor: Cursor, state: CssState): boolean {
  if (state.mode !== "selector") return false;
  if (cursor.line.charAt(cursor.pos) === ",") return emit(cursor, "punct", ",");

  const run = matchAt(cursor, SELECTOR_RUN);
  return run === undefined ? quotedStep(cursor) : emit(cursor, "tag", run);
}

/**
 * A declaration name up to its colon.
 *
 * @param cursor - The cursor.
 * @param state - The CSS state.
 * @returns True when something was consumed.
 */
function propertyStep(cursor: Cursor, state: CssState): boolean {
  if (state.mode !== "property") return false;
  if (cursor.line.charAt(cursor.pos) === ":") {
    state.mode = "value";
    return emit(cursor, "punct", ":");
  }

  const name = matchAt(cursor, CSS_IDENTIFIER);
  return name !== undefined && emit(cursor, "property", name);
}

/**
 * A word in a value or prelude: an at-keyword, `!important`, a function name or an identifier.
 *
 * @param cursor - The cursor.
 * @returns True on a word.
 * @example
 * ```ts
 * cssWordStep(cursorOf("var(--accent)")); // emits function "var"
 * ```
 */
function cssWordStep(cursor: Cursor): boolean {
  const keyword = matchAt(cursor, AT_RULE) ?? matchAt(cursor, CSS_BANG);
  if (keyword !== undefined) return emit(cursor, "keyword", keyword);

  const word = matchAt(cursor, CSS_IDENTIFIER);
  if (word === undefined) return false;
  const call = cursor.line.charAt(cursor.pos + word.length) === "(";
  return emit(cursor, call ? "function" : "plain", word);
}

/**
 * Value and prelude text: strings, numbers, colours, words and punctuation.
 *
 * @param cursor - The cursor.
 * @param state - The CSS state.
 * @returns True when something was consumed.
 */
function valueStep(cursor: Cursor, state: CssState): boolean {
  if (state.mode !== "value" && state.mode !== "prelude") return false;
  if (quotedStep(cursor)) return true;

  const number = matchAt(cursor, CSS_NUMBER) ?? matchAt(cursor, CSS_HEX);
  if (number !== undefined) return emit(cursor, "number", number);
  if (cssWordStep(cursor)) return true;

  const punct = matchAt(cursor, CSS_PUNCT);
  return punct !== undefined && emit(cursor, "punct", punct);
}

/**
 * Statement text: decides a new statement's mode, then runs the step of that mode.
 *
 * @param cursor - The cursor.
 * @param state - The CSS state.
 * @returns True when something was consumed.
 */
function statementStep(cursor: Cursor, state: CssState): boolean {
  if (state.mode === "start") state.mode = statementMode(cursor, state);
  return selectorStep(cursor, state) || propertyStep(cursor, state) || valueStep(cursor, state);
}

/** The CSS steps, in order. */
const CSS_STEPS: readonly Step<CssState>[] = [
  openCommentStep,
  blankStep,
  blockCommentStep,
  cssStructureStep,
  statementStep
];

/**
 * A CSS line scanner with its state.
 *
 * @returns The scanner.
 * @example
 * ```ts
 * const scanLine = cssScanner(); scanLine("a {"); scanLine("  color: red; }");
 * ```
 */
function cssScanner(): (line: string) => Token[] {
  const state: CssState = { comment: false, depth: 0, mode: "start" };
  return line => scan(line, state, () => CSS_STEPS);
}

// ─── json ────────────────────────────────────────────────────────────────────

/** A JSON number. */
const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
/** A JSON literal. */
const JSON_LITERAL = /(?:true|false|null)(?![\w$])/y;
/** JSON punctuation. */
const JSON_PUNCT = /[{}[\],:]/y;
/** Optional blanks and a colon: the string before it is a key. */
const KEY_AHEAD = /[ \t]*:/y;

/**
 * A JSON string: a key when a colon follows, else a value.
 *
 * @param cursor - The cursor.
 * @returns True on a string.
 * @example
 * ```ts
 * jsonStringStep(cursorOf('"key": 1')); // emits property '"key"'
 * ```
 */
function jsonStringStep(cursor: Cursor): boolean {
  if (cursor.line.charAt(cursor.pos) !== '"') return false;

  const start = cursor.pos;
  let index = start + 1;
  while (index < cursor.line.length && cursor.line.charAt(index) !== '"') {
    index += cursor.line.charAt(index) === "\\" ? 2 : 1;
  }
  const end = Math.min(index + 1, cursor.line.length);
  const key = testAt(cursor.line, end, KEY_AHEAD);
  return emit(cursor, key ? "property" : "string", cursor.line.slice(start, end));
}

/**
 * A JSON number, literal or punctuation.
 *
 * @param cursor - The cursor.
 * @returns True when something was consumed.
 * @example
 * ```ts
 * jsonValueStep(cursorOf("true,")); // emits literal "true"
 * ```
 */
function jsonValueStep(cursor: Cursor): boolean {
  const number = matchAt(cursor, JSON_NUMBER);
  if (number !== undefined) return emit(cursor, "number", number);

  const literal = matchAt(cursor, JSON_LITERAL);
  if (literal !== undefined) return emit(cursor, "literal", literal);

  const punct = matchAt(cursor, JSON_PUNCT);
  return punct !== undefined && emit(cursor, "punct", punct);
}

/** The JSON steps, in order. */
const JSON_STEPS: readonly Step<undefined>[] = [blankStep, jsonStringStep, jsonValueStep];

/**
 * Tokenizes one JSON line (JSON keeps no state across lines).
 *
 * @param line - The line.
 * @returns The tokens.
 * @example
 * ```ts
 * jsonLine('"a": 1'); // property, punct, plain, number
 * ```
 */
function jsonLine(line: string): Token[] {
  return scan(line, undefined, () => JSON_STEPS);
}

// ─── markdown ────────────────────────────────────────────────────────────────

/** What the Markdown scanner carries across lines. */
type MarkdownState = { first: boolean; front: boolean; fence: string | undefined };

/** A fence opening or closing: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** An ATX heading. */
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
/** A block quote marker with its leading blanks. */
const QUOTE_MARK = /([ \t]*)>/y;
/** A list marker with its leading blanks, followed by a blank or the line end. */
const LIST_MARK = /([ \t]*)([-*+]|\d+[.)])(?=\s|$)/y;
/** Link text followed by its target. */
const LINK_TEXT = /\[[^\]]*\](?=[([])/y;
/** Plain inline text up to the next code span or link. */
const INLINE_PLAIN = /[^`[]+/y;

/**
 * Emits one leading marker with its blanks: the marker as a keyword.
 *
 * @param cursor - The cursor.
 * @param pattern - A sticky regex with the blanks in group 1 and the marker after them.
 * @returns True on a marker.
 * @example
 * ```ts
 * markerStep(cursorOf("  - item"), LIST_MARK); // plain "  ", keyword "-"
 * ```
 */
function markerStep(cursor: Cursor, pattern: RegExp): boolean {
  pattern.lastIndex = cursor.pos;
  const match = pattern.exec(cursor.line);
  if (match === null) return false;

  const blanks = match[1] ?? "";
  emit(cursor, "plain", blanks);
  return emit(cursor, "keyword", match[0].slice(blanks.length));
}

/**
 * Emits a code span (`…`) or a lone backtick run.
 *
 * @param cursor - The cursor.
 * @returns True on a backtick.
 * @example
 * ```ts
 * codeSpanStep(cursorOf("`code` rest")); // emits string "`code`"
 * ```
 */
function codeSpanStep(cursor: Cursor): boolean {
  const { line, pos } = cursor;
  if (line.charAt(pos) !== "`") return false;

  let run = 1;
  while (line.charAt(pos + run) === "`") run += 1;
  const end = line.indexOf("`".repeat(run), pos + run);
  if (end === -1) return emit(cursor, "plain", line.slice(pos, pos + run));
  return emit(cursor, "string", line.slice(pos, end + run));
}

/**
 * Emits link text (`[text]` before its target) as a type.
 *
 * @param cursor - The cursor.
 * @returns True on link text.
 * @example
 * ```ts
 * linkStep(cursorOf("[docs](./a.md)")); // emits type "[docs]"
 * ```
 */
function linkStep(cursor: Cursor): boolean {
  const link = matchAt(cursor, LINK_TEXT);
  return link !== undefined && emit(cursor, "type", link);
}

/**
 * Emits plain inline text.
 *
 * @param cursor - The cursor.
 * @returns True on text.
 * @example
 * ```ts
 * inlinePlainStep(cursorOf("text `a`")); // emits plain "text "
 * ```
 */
function inlinePlainStep(cursor: Cursor): boolean {
  const text = matchAt(cursor, INLINE_PLAIN);
  return text !== undefined && emit(cursor, "plain", text);
}

/** The inline Markdown steps, in order. */
const INLINE_STEPS: readonly Step<undefined>[] = [codeSpanStep, linkStep, inlinePlainStep];

/**
 * Tokenizes a line of Markdown body text: a heading, or markers and inline spans.
 *
 * @param line - The line.
 * @returns The tokens.
 * @example
 * ```ts
 * markdownBody("- item `a`"); // keyword "-", plain " item ", string "`a`"
 * ```
 */
function markdownBody(line: string): Token[] {
  if (HEADING.test(line)) return whole(line, "heading");

  const cursor = cursorOf(line);
  // Quote markers nest ("> > text"): read them one by one, then at most one list marker.
  let hasQuoteMark = markerStep(cursor, QUOTE_MARK);
  while (hasQuoteMark) hasQuoteMark = markerStep(cursor, QUOTE_MARK);
  markerStep(cursor, LIST_MARK);
  for (const token of scan(line.slice(cursor.pos), undefined, () => INLINE_STEPS)) {
    push(cursor.tokens, token.kind, token.text);
  }
  return cursor.tokens;
}

/**
 * One token for a whole line, none for an empty line.
 *
 * @param line - The line.
 * @param kind - The kind.
 * @returns The tokens.
 * @example
 * ```ts
 * whole("# Title", "heading"); // [{ text: "# Title", kind: "heading" }]
 * ```
 */
function whole(line: string, kind: TokenKind): Token[] {
  return line === "" ? [] : [{ text: line, kind }];
}

/**
 * Tells whether a line closes the open fence: same character, at least as long, nothing after.
 *
 * @param line - The line.
 * @param open - The opening fence marker.
 * @returns True when it closes.
 * @example
 * ```ts
 * closesFence("```", "```"); // true
 * ```
 */
function closesFence(line: string, open: string): boolean {
  const marker = FENCE.exec(line)?.[1];
  if (marker === undefined || marker.charAt(0) !== open.charAt(0)) return false;
  return marker.length >= open.length && line.trim() === marker;
}

/**
 * Tokenizes one Markdown line: front matter, fences, headings and body text.
 *
 * @param line - The line.
 * @param state - The Markdown state.
 * @returns The tokens.
 */
function markdownLine(line: string, state: MarkdownState): Token[] {
  const first = state.first;
  state.first = false;

  if (first && line === "---") {
    state.front = true;
    return whole(line, "meta");
  }
  if (state.front) {
    state.front = line !== "---";
    return whole(line, "meta");
  }
  if (state.fence !== undefined) {
    if (closesFence(line, state.fence)) state.fence = undefined;
    return whole(line, "string");
  }

  state.fence = FENCE.exec(line)?.[1];
  return state.fence === undefined ? markdownBody(line) : whole(line, "string");
}

/**
 * A Markdown line scanner with its state.
 *
 * @returns The scanner.
 * @example
 * ```ts
 * const scanLine = markdownScanner(); scanLine("---"); // [{ text: "---", kind: "meta" }]
 * ```
 */
function markdownScanner(): (line: string) => Token[] {
  const state: MarkdownState = { first: true, front: false, fence: undefined };
  return line => markdownLine(line, state);
}

// ─── public api ──────────────────────────────────────────────────────────────

/** The language of each extension. */
const LANG_OF_EXTENSION: Readonly<Record<string, Lang>> = {
  ts: "script",
  tsx: "script",
  js: "script",
  jsx: "script",
  mjs: "script",
  cjs: "script",
  css: "css",
  json: "json",
  md: "markdown"
};

/**
 * The language of a path by its extension: `.ts .tsx .js .jsx .mjs .cjs` are script, `.css`
 * css, `.json` json, `.md` markdown, anything else plain. The extension is matched without case.
 *
 * @param path - A file path.
 * @returns The language.
 * @example
 * ```ts
 * langOf("nodes/merge.ts"); // "script"
 * langOf("README"); // "plain"
 * ```
 */
export function langOf(path: string): Lang {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "plain";
  return LANG_OF_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "plain";
}

/**
 * Tokenizes one plain line: one plain token.
 *
 * @param line - The line.
 * @returns The tokens.
 * @example
 * ```ts
 * plainLine("anything"); // [{ text: "anything", kind: "plain" }]
 * ```
 */
function plainLine(line: string): Token[] {
  return whole(line, "plain");
}

/**
 * A fresh line scanner for a language.
 *
 * @param lang - The language.
 * @returns The scanner, which keeps its state across the lines of one text.
 * @example
 * ```ts
 * const scanLine = scannerOf("css"); scanLine("a { color: red }");
 * ```
 */
function scannerOf(lang: Lang): (line: string) => Token[] {
  if (lang === "script") return scriptScanner();
  if (lang === "css") return cssScanner();
  if (lang === "json") return jsonLine;
  return lang === "markdown" ? markdownScanner() : plainLine;
}

/**
 * Tokenizes text into one token array per line (split on `\r?\n`). The texts of a line's
 * tokens concatenate to the line exactly, adjacent tokens of one kind are merged, and the
 * scanners never throw: anything unexpected becomes `plain`.
 *
 * @param text - The file text.
 * @param lang - The language.
 * @returns One token array per line.
 * @example
 * ```ts
 * const lines = tokenizeLines(text, langOf("nodes/merge.ts"));
 * lines[0]; // [{ text: "import", kind: "keyword" }, { text: " { ", kind: "plain" }, …]
 * ```
 */
export function tokenizeLines(text: string, lang: Lang): Token[][] {
  const scanner = scannerOf(lang);
  return text.split(/\r?\n/).map(line => scanner(line));
}

/**
 * Renders one line: a `plain` token becomes text, every other token
 * `h("span", { "data-token": kind }, text)`. VNodes only: no innerHTML, no class.
 *
 * @param line - The tokens of one line.
 * @returns The children of the line element.
 * @example
 * ```ts
 * lines.map((line, index) => h("div", { "data-line": index + 1 }, renderTokens(line)));
 * ```
 */
export function renderTokens(line: readonly Token[]): ComponentChildren {
  return line.map(token =>
    token.kind === "plain" ? token.text : h("span", { "data-token": token.kind }, token.text)
  );
}
