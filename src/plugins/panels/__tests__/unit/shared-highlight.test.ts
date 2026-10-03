import { h, type VNode } from "preact";
import { describe, expect, it } from "vitest";
import {
  type Lang,
  langOf,
  renderTokens,
  type Token,
  type TokenKind,
  tokenizeLines
} from "../../shared/highlight";

// ─────────────────────────────────────────────────────────────────────────────
// highlight.ts: hand-written scanners for script, css, json and markdown. The
// token texts of a line always concatenate to the line; tokens render as
// <span data-token> VNodes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The tokens of the first line of a text.
 *
 * @param text - The line.
 * @param lang - The language.
 * @returns The tokens of the first line.
 */
function line(text: string, lang: Lang): Token[] {
  return tokenizeLines(text, lang)[0] ?? [];
}

/**
 * The kind of the first token whose text equals the given text.
 *
 * @param tokens - The tokens of a line.
 * @param text - The token text.
 * @returns Its kind, or undefined when no token has that text.
 */
function kindOf(tokens: readonly Token[], text: string): TokenKind | undefined {
  return tokens.find(token => token.text === text)?.kind;
}

/**
 * The text of every token of a kind.
 *
 * @param tokens - The tokens of a line.
 * @param kind - The kind.
 * @returns The texts.
 */
function textsOf(tokens: readonly Token[], kind: TokenKind): string[] {
  return tokens.filter(token => token.kind === kind).map(token => token.text);
}

/**
 * A deterministic pseudo-random source (mulberry32).
 *
 * @param seed - The seed.
 * @returns A function giving numbers in [0, 1).
 */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = Math.trunc(state + 0x6d_2b_79_f5);
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Characters the fuzz lines are made of: every syntax trigger of every scanner. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: tokenizer input is source text with a literal ${
const FUZZ_ALPHABET = "abcXYZ019_$ \t'\"`${}()[]<>/\\*-+=!?.:;,#@&|~^%";

/** A TS/TSX sample touching every script rule. */
const SCRIPT_SAMPLE = [
  'import { h } from "preact";',
  "/* a block",
  "   comment */ const x = 1;",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: tokenizer input is source text with a literal ${
  "const t = `a ${b + `inner ${c}`} d",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: tokenizer input is source text with a literal ${
  "  still template ${ { k: 1 }.k } end`;",
  String.raw`const re = /[/]+\/x/gi; const half = total / 2;`,
  "export function Panel(props: Props): VNode {",
  '  return <Row key="a" gap={2}>{props.name}</Row>;',
  "}",
  "const big = 1_000_000n + 0xff + 0b1010 + 0o17 + 1.5e-3;",
  "// done"
].join("\n");

/** Every language. */
const LANGS = ["script", "css", "json", "markdown", "plain"] as const;

describe("langOf", () => {
  it.each([
    ["nodes/merge.ts", "script"],
    ["ui/Panel.tsx", "script"],
    ["a.js", "script"],
    ["a.jsx", "script"],
    ["a.mjs", "script"],
    ["a.cjs", "script"],
    ["styles/tokens.css", "css"],
    ["manifest.json", "json"],
    ["notes/idea.md", "markdown"],
    ["README", "plain"],
    ["image.webp", "plain"],
    ["dir.ts/file", "plain"],
    ["UPPER.TS", "script"]
  ] as const)("%s is %s", (path, lang) => {
    expect(langOf(path)).toBe(lang);
  });
});

describe("invariants", () => {
  it.each([
    ["script", SCRIPT_SAMPLE],
    ["css", '@layer a;\n.x { color: var(--a); }\n/* c\n */ b { content: "}" }'],
    ["json", '{\n  "a": [1, true, null],\n  "b": "x"\n}'],
    ["markdown", "---\ntitle: x\n---\n# Head\n- item `code`\n```ts\nconst a = 1;\n```\n[link](u)"],
    ["plain", "anything\n  goes"]
  ] as const)("the tokens of each %s line concatenate to the line", (lang, text) => {
    const lines = tokenizeLines(text, lang);
    const source = text.split(/\r?\n/);
    expect(lines).toHaveLength(source.length);
    for (const [index, tokens] of lines.entries()) {
      expect(tokens.map(token => token.text).join("")).toBe(source[index]);
    }
  });

  it("merges adjacent tokens of the same kind and emits no empty token", () => {
    for (const lang of LANGS) {
      for (const tokens of tokenizeLines(SCRIPT_SAMPLE, lang)) {
        for (const [index, token] of tokens.entries()) {
          expect(token.text.length).toBeGreaterThan(0);
          if (index > 0) expect(tokens[index - 1]?.kind).not.toBe(token.kind);
        }
      }
    }
  });

  it("splits on CRLF and LF alike; an empty text is one empty line", () => {
    expect(tokenizeLines("a\r\nb\nc", "plain")).toEqual([
      [{ text: "a", kind: "plain" }],
      [{ text: "b", kind: "plain" }],
      [{ text: "c", kind: "plain" }]
    ]);
    expect(tokenizeLines("", "script")).toEqual([[]]);
  });

  it("never throws and keeps every text on a fuzz of 200 random lines", () => {
    const next = random(7);
    const lines: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      let text = "";
      const length = Math.floor(next() * 60);
      for (let char = 0; char < length; char += 1) {
        text += FUZZ_ALPHABET[Math.floor(next() * FUZZ_ALPHABET.length)] ?? "";
      }
      lines.push(text);
    }
    const text = lines.join("\n");
    for (const lang of LANGS) {
      const tokenized = tokenizeLines(text, lang);
      expect(tokenized).toHaveLength(200);
      for (const [index, tokens] of tokenized.entries()) {
        expect(tokens.map(token => token.text).join("")).toBe(lines[index]);
      }
    }
  });

  it("plain is one plain token per line", () => {
    expect(tokenizeLines("const a = 1;", "plain")).toEqual([
      [{ text: "const a = 1;", kind: "plain" }]
    ]);
  });
});

describe("script", () => {
  it("keywords and literals", () => {
    const tokens = line(
      "export const a = async () => await this.x ?? null satisfies T; let u = undefined, f = false",
      "script"
    );
    for (const word of ["export", "const", "async", "await", "satisfies", "let"]) {
      expect(kindOf(tokens, word), word).toBe("keyword");
    }
    for (const word of ["this", "null", "undefined", "false"]) {
      expect(kindOf(tokens, word), word).toBe("literal");
    }
  });

  it("types, functions and properties", () => {
    const tokens = line("const node: SceneNode = build(input).nodes.get (id); obj?.deep", "script");
    expect(kindOf(tokens, "SceneNode")).toBe("type");
    expect(kindOf(tokens, "build")).toBe("function");
    expect(kindOf(tokens, "nodes")).toBe("property");
    expect(kindOf(tokens, "get")).toBe("function");
    expect(kindOf(tokens, "deep")).toBe("property");
    expect(kindOf(tokens, "input")).toBe("plain");
    expect(kindOf(line("const o = { width: 1, height: 2 };", "script"), "width")).toBe("property");
    expect(kindOf(line("  label?: string;", "script"), "label")).toBe("property");
  });

  it("strings with escapes and an unterminated string", () => {
    const tokens = line(String.raw`a = 'it\'s'; b = "x\"y"; c = "open`, "script");
    expect(textsOf(tokens, "string")).toEqual([String.raw`'it\'s'`, String.raw`"x\"y"`, '"open']);
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: tokenizer input is source text with a literal ${
  it("a template with nested ${} across lines", () => {
    const lines = tokenizeLines(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: tokenizer input is source text with a literal ${
      "const t = `a ${b + `in ${c}`} d\n  more ${ { k: 1 }.k } end`;\nconst after = 1;",
      "script"
    );
    const [first = [], second = [], third = []] = lines;
    expect(textsOf(first, "string")).toEqual(["`a ", "`in ", "`", " d"]);
    expect(kindOf(first, "b ")).toBe("plain");
    expect(kindOf(first, "c")).toBe("plain");
    expect(textsOf(second, "string")).toEqual(["  more ", " end`"]);
    expect(kindOf(second, "k")).toBe("property");
    expect(kindOf(third, "const")).toBe("keyword");
  });

  it("a block comment across lines", () => {
    const [first = [], second = [], third = []] = tokenizeLines(
      "x /* one\n two\n three */ const y",
      "script"
    );
    expect(textsOf(first, "comment")).toEqual(["/* one"]);
    expect(second).toEqual([{ text: " two", kind: "comment" }]);
    expect(textsOf(third, "comment")).toEqual([" three */"]);
    expect(kindOf(third, "const")).toBe("keyword");
    expect(textsOf(line("a // rest ( `", "script"), "comment")).toEqual(["// rest ( `"]);
  });

  it("regex versus division", () => {
    const regex = line(String.raw`const re = /[/]+\/x/gi; const half = total / 2;`, "script");
    expect(textsOf(regex, "string")).toEqual([String.raw`/[/]+\/x/gi`]);
    expect(kindOf(regex, "/")).toBe("operator");
    expect(textsOf(line("/^a$/.test(s)", "script"), "string")).toEqual(["/^a$/"]);
    expect(textsOf(line("return /b/;", "script"), "string")).toEqual(["/b/"]);
    expect(textsOf(line("(a) / (b) / c", "script"), "string")).toEqual([]);
    expect(textsOf(line("x = a[0] / b", "script"), "string")).toEqual([]);
    expect(textsOf(line("x = (/never closed", "script"), "string")).toEqual([]);
  });

  it("TSX tags and attributes", () => {
    const tokens = line('  return <Row key="a" gap={2} hidden>{name}</Row>;', "script");
    expect(kindOf(tokens, "<Row")).toBe("tag");
    expect(kindOf(tokens, "key")).toBe("attr");
    expect(kindOf(tokens, "gap")).toBe("attr");
    expect(kindOf(tokens, "hidden")).toBe("attr");
    expect(kindOf(tokens, '"a"')).toBe("string");
    expect(kindOf(tokens, "2")).toBe("number");
    expect(kindOf(tokens, "</Row>")).toBe("tag");
    const selfClosing = line('h(x, <Icon name="x" />)', "script");
    expect(textsOf(selfClosing, "tag")).toEqual(["<Icon", "/>"]);
    expect(textsOf(line("if (a < b) c = d > e;", "script"), "tag")).toEqual([]);
    expect(textsOf(line("const list: Array<string> = [];", "script"), "tag")).toEqual([]);
  });

  it("a tag continued on the next line", () => {
    const [first = [], second = [], third = []] = tokenizeLines(
      "const v = (\n  <Button\n    onClick={() => go(1)}>",
      "script"
    );
    expect(textsOf(first, "tag")).toEqual([]);
    expect(kindOf(second, "<Button")).toBe("tag");
    expect(kindOf(third, "onClick")).toBe("attr");
    expect(kindOf(third, "go")).toBe("function");
    expect(textsOf(third, "tag")).toEqual([">"]);
  });

  it("numbers with separators, bigint, hex, binary, octal and exponents", () => {
    const tokens = line("1_000_000n + 0xff_ff + 0b1010 + 0o17 + 1.5e-3 + .5 + 2E10", "script");
    expect(textsOf(tokens, "number")).toEqual([
      "1_000_000n",
      "0xff_ff",
      "0b1010",
      "0o17",
      "1.5e-3",
      ".5",
      "2E10"
    ]);
  });

  it("operators and punctuation", () => {
    const tokens = line("a ??= b?.c === d ... e => f;", "script");
    expect(kindOf(tokens, "??=")).toBe("operator");
    expect(kindOf(tokens, "===")).toBe("operator");
    expect(kindOf(tokens, "...")).toBe("operator");
    expect(kindOf(tokens, "=>")).toBe("operator");
    expect(kindOf(tokens, "?.")).toBe("punct");
    expect(kindOf(tokens, ";")).toBe("punct");
  });
});

describe("css", () => {
  it("at-rules, selectors, properties, values and functions", () => {
    const [first = [], second = [], third = []] = tokenizeLines(
      '@scope ([data-panel]) {\n  :scope { min-width: 0; color: var(--accent) !important; }\n  [data-token="a"], b > c { margin: 1.5rem -2px; background: light-dark(#fff, #000); }\n}',
      "css"
    );
    expect(kindOf(first, "@scope")).toBe("keyword");
    expect(textsOf(second, "tag")).toEqual([":scope"]);
    expect(kindOf(second, "min-width")).toBe("property");
    expect(kindOf(second, "0")).toBe("number");
    expect(kindOf(second, "var")).toBe("function");
    expect(kindOf(second, "--accent")).toBe("plain");
    expect(kindOf(second, "!important")).toBe("keyword");
    expect(kindOf(third, "margin")).toBe("property");
    expect(kindOf(third, "1.5rem")).toBe("number");
    expect(kindOf(third, "-2px")).toBe("number");
    expect(kindOf(third, "light-dark")).toBe("function");
    expect(kindOf(third, "#fff")).toBe("number");
    expect(kindOf(third, '"a"')).toBe("string");
    expect(kindOf(third, "b")).toBe("tag");
  });

  it("comments across lines and strings with braces", () => {
    const [first = [], second = [], third = []] = tokenizeLines(
      'a { /* one\n two */ content: "}"; }\nb { color: red }',
      "css"
    );
    expect(textsOf(first, "comment")).toEqual(["/* one"]);
    expect(kindOf(second, '"}"')).toBe("string");
    expect(kindOf(second, "content")).toBe("property");
    expect(kindOf(third, "b")).toBe("tag");
    expect(kindOf(third, "color")).toBe("property");
  });

  it("an at-rule prelude and a multi-line value", () => {
    const [first = [], second = [], third = []] = tokenizeLines(
      '@media (min-width: 600px) {\n  a { grid-template-areas:\n    "x y"; }',
      "css"
    );
    expect(kindOf(first, "600px")).toBe("number");
    expect(textsOf(first, "tag")).toEqual([]);
    expect(kindOf(second, "grid-template-areas")).toBe("property");
    expect(kindOf(third, '"x y"')).toBe("string");
  });

  it("a nested rule inside braces is a selector", () => {
    const [, second = []] = tokenizeLines("a {\n  &:hover { color: red; }\n}", "css");
    expect(kindOf(second, "&:hover")).toBe("tag");
    expect(kindOf(second, "color")).toBe("property");
  });
});

describe("json", () => {
  it("a key versus a string value, numbers, literals and punctuation", () => {
    const tokens = line(
      String.raw`{ "key" : "va\"l", "n": -1.5e2, "t": [true, false, null] }`,
      "json"
    );
    expect(kindOf(tokens, '"key"')).toBe("property");
    expect(kindOf(tokens, '"n"')).toBe("property");
    expect(kindOf(tokens, String.raw`"va\"l"`)).toBe("string");
    expect(kindOf(tokens, "-1.5e2")).toBe("number");
    expect(textsOf(tokens, "literal")).toEqual(["true", "false", "null"]);
    expect(kindOf(tokens, "{")).toBe("punct");
    expect(kindOf(line('"open', "json"), '"open')).toBe("string");
  });
});

describe("markdown", () => {
  it("front matter, heading, fence, list marker, quote, code span and link text", () => {
    const lines = tokenizeLines(
      [
        "---",
        "title: Idea",
        "---",
        "# Heading",
        "- item with `code` and [link](https://x)",
        "1. first",
        "> quoted",
        "```ts",
        "# not a heading",
        "```",
        "plain text"
      ].join("\n"),
      "markdown"
    );
    expect(lines[0]).toEqual([{ text: "---", kind: "meta" }]);
    expect(lines[1]).toEqual([{ text: "title: Idea", kind: "meta" }]);
    expect(lines[2]).toEqual([{ text: "---", kind: "meta" }]);
    expect(lines[3]).toEqual([{ text: "# Heading", kind: "heading" }]);
    const item = lines[4] ?? [];
    expect(kindOf(item, "-")).toBe("keyword");
    expect(kindOf(item, "`code`")).toBe("string");
    expect(kindOf(item, "[link]")).toBe("type");
    expect(kindOf(lines[5] ?? [], "1.")).toBe("keyword");
    expect(kindOf(lines[6] ?? [], ">")).toBe("keyword");
    expect(lines[7]).toEqual([{ text: "```ts", kind: "string" }]);
    expect(lines[8]).toEqual([{ text: "# not a heading", kind: "string" }]);
    expect(lines[9]).toEqual([{ text: "```", kind: "string" }]);
    expect(lines[10]).toEqual([{ text: "plain text", kind: "plain" }]);
  });

  it("a --- that is not on the first line is not front matter", () => {
    const lines = tokenizeLines("text\n---\nmore", "markdown");
    expect(lines[1]).toEqual([{ text: "---", kind: "plain" }]);
    expect(lines[2]).toEqual([{ text: "more", kind: "plain" }]);
  });
});

describe("renderTokens", () => {
  it("gives text for plain and span[data-token] otherwise, never a class", () => {
    const children = renderTokens([
      { text: "const", kind: "keyword" },
      { text: " a ", kind: "plain" },
      { text: "1", kind: "number" }
    ]);
    expect(Array.isArray(children)).toBe(true);
    const [keyword, plain, number] = children as [VNode<Record<string, string>>, string, VNode];
    expect(plain).toBe(" a ");
    expect(keyword.type).toBe("span");
    expect(keyword.props).toEqual({ "data-token": "keyword", children: "const" });
    expect(keyword.props).not.toHaveProperty("class");
    expect(keyword.props).not.toHaveProperty("className");
    expect(keyword.props).not.toHaveProperty("dangerouslySetInnerHTML");
    const expected = h("span", { "data-token": "number" }, "1");
    expect(number.type).toBe(expected.type);
    expect(number.props).toEqual(expected.props);
    expect(renderTokens([])).toEqual([]);
  });
});

describe("budget", () => {
  it("tokenizes 2000 lines of TS in at most 10 ms", () => {
    const sample = SCRIPT_SAMPLE.split("\n");
    const text = Array.from({ length: 2000 }, (_, index) => sample[index % sample.length]).join(
      "\n"
    );
    tokenizeLines(text, "script");
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      tokenizeLines(text, "script");
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThanOrEqual(10);
  });
});
