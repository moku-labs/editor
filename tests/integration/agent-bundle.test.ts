import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The agent drops out of a game's production bundle (U10 finding 2). A tiny game
// entry imports `@moku-labs/editor/agent` the way the README's "Production
// builds" section recommends, and Bun.build bundles it against the built
// package (dist, resolved through package.json, so `sideEffects: false` and the
// `/* @__PURE__ */` agent core, plugins and core configs apply). With
// `__MOKU_GAME_DEV__` false nothing of the agent is left; with true the bridge
// and capture are there. An agent export used outside the dev branch keeps what
// it references and drops the rest (here: capture).
// Needs `bun run build` first: without dist/agent.mjs the suite is skipped.
// ─────────────────────────────────────────────────────────────────────────────

/** The repository root: the package the entry resolves. */
const REPO = fileURLToPath(new URL("../../", import.meta.url));

/** The built agent entry. */
const AGENT = path.join(REPO, "dist", "agent.mjs");

/**
 * Strings only the agent carries: the bridge hello route, a capture command id, bridge log events,
 * the editor's error prefix.
 */
const AGENT_MARKS = ["/__editor/hello", "editor.capture", "bridge:", "moku-editor"] as const;

/** A string only the capture plugin carries: its large-series warning. */
const CAPTURE_MARK = "capture:series-large";

/** The recommended dev entry: the agent is imported only behind the engine's dev flag. */
const DYNAMIC_ENTRY = `import { createApp as createGame } from "@moku-labs/game";
const app = createGame({});
await app.start();
if (__MOKU_GAME_DEV__) {
  const { createApp, bridgePlugin, capturePlugin } = await import("@moku-labs/editor/agent");
  await createApp({ plugins: [bridgePlugin, capturePlugin], pluginConfigs: { registry: { game: app } } }).start();
}
`;

/** The same entry with a static import: the dead branch leaves every import unused. */
const STATIC_ENTRY = `import { createApp as createGame } from "@moku-labs/game";
import { bridgePlugin, capturePlugin, createApp } from "@moku-labs/editor/agent";
const app = createGame({});
await app.start();
if (__MOKU_GAME_DEV__) {
  await createApp({ plugins: [bridgePlugin, capturePlugin], pluginConfigs: { registry: { game: app } } }).start();
}
`;

/** One static import, `createApp`, used only inside the dev branch. */
const STATIC_ONE_ENTRY = `import { createApp as createGame } from "@moku-labs/game";
import { createApp } from "@moku-labs/editor/agent";
const app = createGame({});
await app.start();
if (__MOKU_GAME_DEV__) {
  await createApp({ pluginConfigs: { registry: { game: app } } }).start();
}
`;

/** A plugin imported type-only: types are erased, nothing of the agent is bundled. */
const TYPE_ONLY_ENTRY = `import { createApp as createGame } from "@moku-labs/game";
import type { bridgePlugin } from "@moku-labs/editor/agent";
const app = createGame({});
const devPlugins: (typeof bridgePlugin)[] = [];
await app.start();
console.info(devPlugins.length);
`;

/** A static import used outside the dev branch: the bridge stays, unreferenced plugins drop. */
const OUTSIDE_ENTRY = `import { createApp as createGame } from "@moku-labs/game";
import { bridgePlugin } from "@moku-labs/editor/agent";
const app = createGame({});
await app.start();
console.info("editor plugin", bridgePlugin.name);
`;

/** What one bundle produced: its text and its sizes. */
type Bundle = { readonly text: string; readonly bytes: number; readonly gzip: number };

if (!existsSync(AGENT)) {
  console.warn(`agent-bundle: ${AGENT} not found, run \`bun run build\` first: skipping`);
}

let dir: string;

beforeAll(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "moku-agent-bundle-")));
  await mkdir(path.join(dir, "node_modules", "@moku-labs"), { recursive: true });
  await symlink(REPO, path.join(dir, "node_modules", "@moku-labs", "editor"), "dir");
  await writeFile(path.join(dir, "dynamic.ts"), DYNAMIC_ENTRY);
  await writeFile(path.join(dir, "static.ts"), STATIC_ENTRY);
  await writeFile(path.join(dir, "static-one.ts"), STATIC_ONE_ENTRY);
  await writeFile(path.join(dir, "type-only.ts"), TYPE_ONLY_ENTRY);
  await writeFile(path.join(dir, "outside.ts"), OUTSIDE_ENTRY);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Bundles one entry for the browser, minified, with the dev flag defined. The game itself is
 * external: the sizes are what the editor adds.
 *
 * @param entry - The entry file name in the temp folder.
 * @param dev - The value of `__MOKU_GAME_DEV__`.
 * @returns The joined output text and its sizes.
 */
async function bundle(entry: string, dev: "true" | "false"): Promise<Bundle> {
  const result = await Bun.build({
    entrypoints: [path.join(dir, entry)],
    target: "browser",
    format: "esm",
    minify: true,
    define: { __MOKU_GAME_DEV__: dev },
    external: ["@moku-labs/game", "@moku-labs/game/*"]
  });
  if (!result.success) throw new AggregateError(result.logs, `bundling ${entry} failed`);

  const texts = await Promise.all(result.outputs.map(output => output.text()));
  const text = texts.join("\n");
  const bytes = new TextEncoder().encode(text);
  return { text, bytes: bytes.length, gzip: Bun.gzipSync(bytes).length };
}

/**
 * The built agent: `dist/agent.mjs` and the chunks it imports. tsdown puts the agent core in a
 * chunk it shares with `dist/agent-page.mjs` (D-49), so the entry itself only re-exports.
 *
 * @returns The joined text.
 */
async function builtAgent(): Promise<string> {
  const entry = await Bun.file(AGENT).text();
  const chunks = [...entry.matchAll(/from "\.\/([^"]+\.mjs)"/g)].map(match => match[1] ?? "");
  const texts = await Promise.all(
    chunks.map(chunk => Bun.file(path.join(REPO, "dist", chunk)).text())
  );
  return [entry, ...texts].join("\n");
}

/**
 * The agent marks a bundle contains.
 *
 * @param output - A bundle.
 * @returns The marks found, in AGENT_MARKS order.
 */
function marksIn(output: Bundle): string[] {
  return AGENT_MARKS.filter(mark => output.text.includes(mark));
}

describe.skipIf(!existsSync(AGENT))("the agent in a game bundle", () => {
  it("drops out with __MOKU_GAME_DEV__ false and is there with true (the README entry)", async () => {
    const production = await bundle("dynamic.ts", "false");
    const dev = await bundle("dynamic.ts", "true");

    expect(marksIn(production)).toEqual([]);
    expect(production.bytes).toBeLessThan(1024);
    expect(marksIn(dev)).toEqual([...AGENT_MARKS]);
    console.info(
      `agent-bundle: production ${production.bytes} B (${production.gzip} B gzip), dev ${dev.bytes} B (${dev.gzip} B gzip)`
    );
  });

  it("drops out of a static import behind the flag too (sideEffects: false)", async () => {
    expect(marksIn(await bundle("static.ts", "false"))).toEqual([]);
    expect(marksIn(await bundle("static.ts", "true"))).toEqual([...AGENT_MARKS]);
  });

  it("drops one static import used only in the dev branch and a type-only plugin import", async () => {
    const staticOne = await bundle("static-one.ts", "false");
    const typeOnly = await bundle("type-only.ts", "false");

    expect(marksIn(staticOne)).toEqual([]);
    expect(staticOne.bytes).toBeLessThan(1024);
    expect(marksIn(typeOnly)).toEqual([]);
    expect(typeOnly.bytes).toBeLessThan(1024);
  });

  it("keeps only what an export used outside the dev branch references", async () => {
    const outside = await bundle("outside.ts", "false");
    const dev = await bundle("dynamic.ts", "true");

    expect(outside.text).toContain("bridge:");
    expect(outside.text).not.toContain(CAPTURE_MARK);
    expect(dev.text).toContain(CAPTURE_MARK);
    expect(outside.bytes).toBeLessThan(dev.bytes);
    console.info(
      `agent-bundle: export outside the dev branch ${outside.bytes} B (${outside.gzip} B gzip)`
    );
  });

  it("keeps the pure annotations on the agent core and plugins in dist/agent.mjs and its chunks", async () => {
    const built = await builtAgent();

    expect(built).toContain("/* @__PURE__ */ createAgentCore(");
    for (const name of ["registry", "channel", "overlay", "bridge", "capture"]) {
      expect(built).toContain(`/* @__PURE__ */ createAgentPlugin("${name}"`);
    }
  });
});
