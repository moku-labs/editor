import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Every source file of the overlay (tests excluded), relative to its folder.
 *
 * @param dir - The folder.
 * @returns The paths.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
    file => /\.tsx?$/.test(file) && !file.startsWith("__tests__")
  );
}

/**
 * The import specifiers of a file.
 *
 * @param text - The file's text.
 * @returns The specifiers.
 */
function importsOf(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1] ?? "");
}

describe("the overlay's imports of the hub", () => {
  it("an overlay file imports the hub index (only hub/protocol is reached)", () => {
    const hubImports: string[] = [];
    for (const file of sources(ROOT)) {
      for (const specifier of importsOf(readFileSync(path.join(ROOT, file), "utf8"))) {
        if (/(^|\/)hub(\/|$)/.test(specifier)) hubImports.push(`${file}: ${specifier}`);
      }
    }
    expect(hubImports.length).toBeGreaterThan(0);
    for (const entry of hubImports) expect(entry).toMatch(/: (\.\.\/)+hub\/protocol$/);
  });
});
