import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../../server";

// ─────────────────────────────────────────────────────────────────────────────
// build:tools (D-06): runs scripts/build-tools.ts into a temp folder (so the
// repo's dist/tools is never wiped under a parallel test), then serves the
// result through the real server core and walks every referenced asset.
// ─────────────────────────────────────────────────────────────────────────────

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const PLUGINS = join(REPO, "src", "plugins");
const PAGE_CSS = join(PLUGINS, "pages", "page", "index.css");
/** The plugin folders whose sheets the tools page must reach. */
const SHEET_PLUGINS = [
  "workspace",
  "panels",
  "flowView",
  "gameView",
  "renderView",
  "stateView",
  "filesView",
  "consoleView"
];

let outDir: string;
let base: string;
let buildOutput = "";
let buildCode = -1;
let app: ReturnType<typeof createApp>;
let server: ReturnType<typeof Bun.serve>;
let origin: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "moku-tools-build-"));
  base = await realpath(await mkdtemp(join(tmpdir(), "moku-tools-root-")));
  const child = Bun.spawn(["bun", "scripts/build-tools.ts", "--outdir", outDir], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe"
  });
  const [out, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  buildCode = await child.exited;
  buildOutput = out + error;
  app = createApp({
    pluginConfigs: { files: { root: base }, pages: { pageDir: outDir } }
  });
  app.log.clearSinks();
  await app.start();
  server = Bun.serve(app.hub.serve({ port: 0 }));
  origin = `http://127.0.0.1:${server.port}`;
}, 120_000);

afterAll(async () => {
  await app.stop().catch(() => undefined);
  await Promise.race([server.stop(true), Bun.sleep(300)]);
  await rm(outDir, { recursive: true, force: true });
  await rm(base, { recursive: true, force: true });
});

/**
 * Every file under a folder, as paths relative to it.
 *
 * @param dir - The folder.
 * @returns Relative paths.
 */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)));
}

/**
 * Every sheet reachable from a CSS file through relative `@import`s.
 *
 * @param file - The entry sheet.
 * @param seen - Sheets already visited.
 * @returns The absolute paths.
 */
async function reachable(file: string, seen = new Set<string>()): Promise<Set<string>> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)) {
    const target = match[1];
    if (target?.startsWith(".")) {
      await reachable(resolve(dirname(file), target), seen);
    }
  }
  return seen;
}

describe("build:tools", () => {
  it("exits 0 and prints its layout checks", () => {
    expect(buildOutput).not.toContain("✗");
    expect(buildCode).toBe(0);
    expect(buildOutput).toContain("index.html");
    expect(buildOutput).toMatch(/woff2/);
  });

  it("writes index.html at the root and everything else under assets/", async () => {
    const files = await filesUnder(outDir);
    expect(files).toContain("index.html");
    for (const file of files)
      if (file !== "index.html") expect(file.startsWith("assets/"), file).toBe(true);
    expect(files.some(file => file.endsWith(".woff2"))).toBe(true);
    expect(files.filter(file => file.endsWith(".css"))).toHaveLength(1);
  });

  it("serves P/ whose asset URLs start with ./assets/ and answer 200 with their types", async () => {
    const html = await fetch(`${origin}/__editor/`).then(response => response.text());
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1] ?? "");
    expect(urls.length).toBeGreaterThanOrEqual(2);
    const types: string[] = [];
    for (const url of urls) {
      expect(url.startsWith("./assets/"), url).toBe(true);
      const response = await fetch(new URL(url, `${origin}/__editor/`));
      expect(response.status, url).toBe(200);
      types.push(response.headers.get("content-type") ?? "");
    }
    expect(types).toContain("text/javascript; charset=utf-8");
    expect(types).toContain("text/css; charset=utf-8");
  });

  it("bundles one CSS with the family layer order and font files served as font/woff2", async () => {
    const html = await fetch(`${origin}/__editor/`).then(response => response.text());
    const href = /href="(\.\/assets\/[^"]+\.css)"/.exec(html)?.[1] ?? "";
    const cssUrl = new URL(href, `${origin}/__editor/`);
    const css = await fetch(cssUrl).then(response => response.text());
    expect(css).toMatch(
      /@layer\s*reset,\s*tokens,\s*base,\s*components,\s*animations,\s*utilities;/
    );
    expect(css).not.toContain("url(data:font");
    const fonts = [...css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map(
      match => match[1] ?? ""
    );
    expect(fonts.length).toBeGreaterThanOrEqual(1);
    for (const font of fonts) {
      const response = await fetch(new URL(font, cssUrl));
      expect(response.status, font).toBe(200);
      expect(response.headers.get("content-type")).toBe("font/woff2");
    }
  });

  // Regression (e2e): Bun.build kept `with { type: "text" }` on the dynamic import of the ELK
  // worker chunk; browsers refuse it, so the layout worker never started on the tools page.
  it("imports the ELK worker chunk with no import attribute", async () => {
    const files = await filesUnder(outDir);
    const scripts = files.filter(file => file.endsWith(".js"));
    const texts = await Promise.all(scripts.map(file => readFile(join(outDir, file), "utf8")));
    const imports = texts.flatMap(text => [...text.matchAll(/import\(["']\.\/elk-worker[^)]*\)/g)]);
    expect(imports.length).toBeGreaterThan(0);
    for (const [call] of imports) expect(call).not.toContain("with");
    for (const text of texts) expect(text).not.toMatch(/\{\s*with\s*:\s*\{\s*type\s*:/);
  });

  it("reaches every view and workspace sheet from page/index.css", async () => {
    const reached = await reachable(PAGE_CSS);
    const missing: string[] = [];
    for (const plugin of SHEET_PLUGINS) {
      const dir = join(PLUGINS, plugin);
      for (const file of await filesUnder(dir)) {
        if (!file.endsWith(".css") || file.includes("__tests__")) continue;
        if (!reached.has(join(dir, file))) missing.push(`${plugin}/${file}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
