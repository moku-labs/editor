/**
 * @file The build:tools step (D-06): bundles the tools page (src/plugins/pages/page: index.html,
 * main.tsx, index.css and the fonts it reaches) with Bun.build into dist/tools/. Output through
 * the branded console (MC1). The pages builder adds the layout checks of 09-pages step 4 in wave 4
 * (index.html at the root, everything else under assets/, one stylesheet, at least one woff2).
 */
import { rm } from "node:fs/promises";
import { createBrandConsole } from "@moku-labs/common/cli";

const PAGE_ENTRY = "src/plugins/pages/page/index.html";
const OUT_DIR = "dist/tools";
const ui = createBrandConsole();

/**
 * Builds the tools page into dist/tools and reports the output.
 *
 * @returns The process exit code: 0 when the page was built, 1 when Bun.build failed.
 * @example
 * ```ts
 * process.exitCode = await buildTools();
 * ```
 */
async function buildTools(): Promise<number> {
  await rm(OUT_DIR, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [PAGE_ENTRY],
    outdir: OUT_DIR,
    target: "browser",
    format: "esm",
    minify: true,
    splitting: true,
    sourcemap: "linked",
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

  let bytes = 0;
  for (const output of result.outputs) bytes += output.size;

  ui.info(`${OUT_DIR} · ${result.outputs.length} files · ${Math.round(bytes / 1024)} kB`);
  return 0;
}

process.exitCode = await buildTools();
