import { describe, expect, it } from "vitest";
import { compileGlob } from "../../glob";

const exact = { caseInsensitive: false };
const loose = { caseInsensitive: true };

describe("compileGlob", () => {
  it("anchors the expression", () => {
    const glob = compileGlob("a.ts", exact);
    expect(glob.test("a.ts")).toBe(true);
    expect(glob.test("xa.ts")).toBe(false);
    expect(glob.test("a.tsx")).toBe(false);
  });

  it("matches **/ as zero or more whole segments", () => {
    const glob = compileGlob("**/*.ts", exact);
    expect(glob.test("a.ts")).toBe(true);
    expect(glob.test("x/a.ts")).toBe(true);
    expect(glob.test("x/y/a.ts")).toBe(true);
    expect(glob.test("x/y/a.tsx")).toBe(false);
    expect(glob.test("x/y/a.js")).toBe(false);
  });

  it("matches **/ in the middle as zero or more segments", () => {
    const glob = compileGlob("a/**/b.ts", exact);
    expect(glob.test("a/b.ts")).toBe(true);
    expect(glob.test("a/x/y/b.ts")).toBe(true);
    expect(glob.test("ab.ts")).toBe(false);
  });

  it("matches a trailing /** as the folder itself or anything below it", () => {
    const glob = compileGlob(".moku/**", exact);
    expect(glob.test(".moku")).toBe(true);
    expect(glob.test(".moku/a")).toBe(true);
    expect(glob.test(".moku/a/b")).toBe(true);
    expect(glob.test(".mokux")).toBe(false);
    expect(glob.test("x/.moku")).toBe(false);
  });

  it("matches a deny glob with both a leading **/ and a trailing /**", () => {
    const glob = compileGlob("**/node_modules/**", exact);
    expect(glob.test("node_modules")).toBe(true);
    expect(glob.test("node_modules/pkg/index.ts")).toBe(true);
    expect(glob.test("packages/a/node_modules/b.ts")).toBe(true);
    expect(glob.test("my_node_modules/b.ts")).toBe(false);
  });

  it("matches ** elsewhere as anything, slashes included", () => {
    const glob = compileGlob("src**.ts", exact);
    expect(glob.test("src/a/b.ts")).toBe(true);
    expect(glob.test("src.ts")).toBe(true);
  });

  it("matches * inside one segment only", () => {
    const glob = compileGlob("src/*.ts", exact);
    expect(glob.test("src/a.ts")).toBe(true);
    expect(glob.test("src/.ts")).toBe(true);
    expect(glob.test("src/a/b.ts")).toBe(false);
  });

  it("matches ? as one character other than a slash", () => {
    const glob = compileGlob("a?.ts", exact);
    expect(glob.test("ab.ts")).toBe(true);
    expect(glob.test("a.ts")).toBe(false);
    expect(glob.test("a/.ts")).toBe(false);
  });

  it("matches {a,b} alternation", () => {
    const glob = compileGlob("**/*.{ts,tsx}", exact);
    expect(glob.test("x/a.ts")).toBe(true);
    expect(glob.test("x/a.tsx")).toBe(true);
    expect(glob.test("x/a.json")).toBe(false);
  });

  it("treats an unclosed brace and a nested brace as literal characters", () => {
    expect(compileGlob("a{b", exact).test("a{b")).toBe(true);
    expect(compileGlob("{a,{b}", exact).test("{b")).toBe(true);
  });

  it("escapes regular expression characters", () => {
    expect(compileGlob("a+b(c).ts", exact).test("a+b(c).ts")).toBe(true);
    expect(compileGlob("a+b(c).ts", exact).test("aab(c)xts")).toBe(false);
    expect(compileGlob("a.ts", exact).test("axts")).toBe(false);
    expect(compileGlob(String.raw`[x]^$|\.ts`, exact).test(String.raw`[x]^$|\.ts`)).toBe(true);
  });

  it("matches dot files like any name", () => {
    const glob = compileGlob("**/.env*", exact);
    expect(glob.test(".env")).toBe(true);
    expect(glob.test(".env.local")).toBe(true);
    expect(glob.test("config/.env.json")).toBe(true);
    expect(compileGlob("*.ts", exact).test(".hidden.ts")).toBe(true);
  });

  it("is case-sensitive unless asked otherwise", () => {
    expect(compileGlob("**/node_modules/**", exact).test("Node_Modules/x")).toBe(false);
    expect(compileGlob("**/node_modules/**", loose).test("Node_Modules/x")).toBe(true);
    expect(compileGlob("**/.git/**", loose).test(".GIT/HEAD")).toBe(true);
  });

  it("matches ** alone as anything", () => {
    expect(compileGlob("**", exact).test("a/b/c")).toBe(true);
  });
});
