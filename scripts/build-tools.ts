/**
 * @file The build:tools step (D-06): bundles the tools page (src/plugins/pages/page: index.html,
 * main.tsx, index.css and the fonts it reaches) with Bun.build into dist/tools/ (or `--outdir`).
 * Bun inlines CSS fonts as data URLs, which the tools page CSP (`default-src 'self'`) refuses, so
 * the woff2 files stay external and are copied into assets/ with hashed names. Then the 09-pages
 * step 4 layout checks run. Output through the branded console (MC1).
 */
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createBrandConsole } from "@moku-labs/common/cli";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const PAGE_ENTRY = join(REPO, "src/plugins/pages/page/index.html");
const FONT_DIR = join(REPO, "src/plugins/workspace/styles/fonts");
const ui = createBrandConsole();

/**
 * A `url(./fonts/<name>.woff2)` left external in the bundled CSS.
 */
const FONT_URL = /url\((["']?)\.\/fonts\/([\w.-]+)\.woff2\1\)/g;

/**
 * Eight hex characters of a sha256.
 *
 * @param bytes - The content.
 * @returns The short hash.
 * @example
 * ```ts
 * shortHash(new Uint8Array([1])); // "4bf5122f"
 * ```
 */
function shortHash(bytes: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 8);
}

/**
 * Copies each font a CSS file references into assets/ with a hashed name, points the CSS at it,
 * and renames the CSS by its new content hash.
 *
 * @param outDir - The output folder.
 * @param cssPath - Absolute path of the bundled CSS under assets/.
 * @returns The new CSS path.
 * @example
 * ```ts
 * await externalizeFonts("dist/tools", "dist/tools/assets/index-abc.css");
 * ```
 */
async function externalizeFonts(outDir: string, cssPath: string): Promise<string> {
  const css = await readFile(cssPath, "utf8");
  const copies = new Map<string, string>();
  for (const match of css.matchAll(FONT_URL)) {
    const stem = match[2] ?? "";
    if (copies.has(stem)) continue;
    const bytes = await readFile(join(FONT_DIR, `${stem}.woff2`));
    const name = `${stem}-${shortHash(bytes)}.woff2`;
    await copyFile(join(FONT_DIR, `${stem}.woff2`), join(outDir, "assets", name));
    copies.set(stem, name);
  }
  const rewritten = css.replaceAll(FONT_URL, (_match, _quote, stem: string) => {
    return `url(./${copies.get(stem) ?? stem})`;
  });
  const renamed = cssPath.replace(/-[^-/]+\.css$/, `-${shortHash(rewritten)}.css`);
  await writeFile(renamed, rewritten);
  if (renamed !== cssPath) await rm(cssPath);

  const htmlPath = join(outDir, "index.html");
  const html = await readFile(htmlPath, "utf8");
  const from = `./${relative(outDir, cssPath)}`;
  await writeFile(htmlPath, html.replace(from, `./${relative(outDir, renamed)}`));
  return renamed;
}

/**
 * Every file under a folder, relative to it.
 *
 * @param dir - The folder.
 * @returns Relative paths.
 * @example
 * ```ts
 * await filesUnder("dist/tools"); // ["index.html", "assets/index-abc.js", …]
 * ```
 */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)));
}

/**
 * Runs the 09-pages step 4 checks and prints each one.
 *
 * @param outDir - The output folder.
 * @returns Whether every check passed.
 * @example
 * ```ts
 * if (!(await checkLayout("dist/tools"))) return 1;
 * ```
 */
async function checkLayout(outDir: string): Promise<boolean> {
  const files = await filesUnder(outDir);
  const html = files.includes("index.html")
    ? await readFile(join(outDir, "index.html"), "utf8")
    : "";
  const urls = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map(match => match[1] ?? "");
  const sheets = [...html.matchAll(/<link[^>]*rel="stylesheet"/g)];
  const checks: [boolean, string][] = [
    [files.includes("index.html"), "index.html at the root"],
    [
      files.every(file => file === "index.html" || file.startsWith("assets/")),
      "every other file under assets/"
    ],
    [/<\/head>/i.test(html), "index.html has </head>"],
    [
      urls.length > 0 && urls.every(url => url.startsWith("./assets/")),
      "every src/href starts with ./assets/"
    ],
    [sheets.length === 1, "exactly one stylesheet linked"],
    [
      files.some(file => file.startsWith("assets/") && file.endsWith(".woff2")),
      "Geist woff2 fonts in assets/"
    ]
  ];
  for (const [ok, label] of checks) ui.check(ok, label);
  return checks.every(([ok]) => ok);
}

/**
 * Builds the tools page and reports the output.
 *
 * @returns The process exit code: 0 when the page was built and checked, 1 otherwise.
 * @example
 * ```ts
 * process.exitCode = await buildTools();
 * ```
 */
async function buildTools(): Promise<number> {
  const { values } = parseArgs({ options: { outdir: { type: "string" } } });
  const outDir = values.outdir ?? join(REPO, "dist/tools");
  await rm(outDir, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [PAGE_ENTRY],
    outdir: outDir,
    target: "browser",
    format: "esm",
    minify: true,
    splitting: true,
    sourcemap: "linked",
    external: ["*.woff2"],
    naming: {
      entry: "[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]"
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") } // @env-allow — a define key of the bundle, not an env read
  });

  if (!result.success) {
    ui.error("build:tools failed", result.logs);
    return 1;
  }

  for (const output of result.outputs) {
    if (output.path.endsWith(".css")) await externalizeFonts(outDir, output.path);
  }
  if (!(await checkLayout(outDir))) {
    ui.error("build:tools layout checks failed");
    return 1;
  }

  const files = await filesUnder(outDir);
  let bytes = 0;
  for (const file of files) bytes += Bun.file(join(outDir, file)).size;

  ui.info(
    `${relative(REPO, outDir) || outDir} · ${files.length} files · ${Math.round(bytes / 1024)} kB`
  );
  return 0;
}

process.exitCode = await buildTools();
