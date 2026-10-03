import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootJsonOf, rawGet } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The moku-editor bin as a real process: a tiny game folder and the merge-game
// fixture page, served next to the editor on a random port.
// ─────────────────────────────────────────────────────────────────────────────

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const BIN = join(REPO, "src", "plugins", "pages", "bin.ts");
const MERGE_GAME = fileURLToPath(
  new URL("../game/tests/integration/merge-game/", `file://${REPO}`)
);

/** A spawned bin and the stdout read so far. */
type Running = {
  readonly child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  readonly port: number;
  output: () => string;
};

/**
 * Spawns the bin and waits for its Tools line.
 *
 * @param args - Bin arguments.
 * @returns The running bin with its real port.
 */
async function spawnBin(args: string[]): Promise<Running> {
  const child = Bun.spawn(["bun", BIN, ...args], {
    cwd: REPO,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  let text = "";
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + 20_000;
  while (!/Tools\s+http/.test(text) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  const pump = async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      text += decoder.decode(value);
    }
  };
  void pump();
  const port = Number(/Game\s+http:\/\/127\.0\.0\.1:(\d+)\//.exec(text)?.[1] ?? 0);
  return { child, port, output: () => text };
}

/**
 * Runs the bin to completion.
 *
 * @param args - Bin arguments.
 * @returns Exit code and all output.
 */
async function runBin(args: string[]): Promise<{ code: number; output: string }> {
  const child = Bun.spawn(["bun", BIN, ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const [out, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { code: await child.exited, output: out + error };
}

let game: string;

beforeAll(async () => {
  if (!existsSync(join(REPO, "dist", "tools", "index.html"))) {
    const build = Bun.spawn(["bun", "scripts/build-tools.ts"], {
      cwd: REPO,
      stdout: "ignore",
      stderr: "ignore"
    });
    expect(await build.exited).toBe(0);
  }
  game = await realpath(await mkdtemp(join(tmpdir(), "moku-bin-")));
  await writeFile(
    join(game, "index.html"),
    '<!doctype html><html><head><title>tiny game</title></head><body><div id="tiny"></div><script type="module" src="./main.ts"></script></body></html>'
  );
  await writeFile(join(game, "main.ts"), 'document.title = "tiny game";\n');
  await writeFile(join(game, "data.json"), '{"level":1}');
  await writeFile(join(game, ".env"), "SECRET=1");
}, 120_000);

afterAll(async () => {
  await rm(game, { recursive: true, force: true });
});

describe("moku-editor bin", () => {
  it("serves the game, its files and the editor; stops on SIGINT with 0", async () => {
    const bin = await spawnBin([join(game, "index.html"), "--port", "0", "--root", game]);
    try {
      expect(bin.port).toBeGreaterThan(0);
      const origin = `http://127.0.0.1:${bin.port}`;
      const page = await fetch(`${origin}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('id="tiny"');
      const data = await fetch(`${origin}/data.json`);
      expect(data.status).toBe(200);
      expect(await data.json()).toEqual({ level: 1 });
      await expect(fetch(`${origin}/.env`)).resolves.toHaveProperty("status", 404);
      await expect(rawGet(bin.port, "/data.json", `evil.com:${bin.port}`)).resolves.toHaveProperty(
        "status",
        403
      );
      const tools = await fetch(`${origin}/__editor/`);
      expect(tools.status).toBe(200);
      const boot = JSON.parse(bootJsonOf(await tools.text()) ?? "{}");
      expect(boot.root).toBe(game);
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      expect(hello.status).toBe(200);
      const { token } = await hello.json();
      expect(token).toBe(boot.token);
      expect(bin.output()).toContain(`Tools  ${origin}/__editor/`);
      expect(bin.output()).not.toContain(token);

      const second = await runBin([join(game, "index.html"), "--port", String(bin.port)]);
      expect(second.code).toBe(1);
      expect(second.output).toContain("is in use");
      expect(second.output).toContain(`--port ${bin.port + 1}`);
    } finally {
      bin.child.kill("SIGINT");
    }
    expect(await bin.child.exited).toBe(0);
    expect(bin.output()).toContain("stopped");
  }, 60_000);

  // CI checks out only this repository: without the sibling game the fixture case is skipped.
  it.skipIf(!existsSync(MERGE_GAME))(
    "serves the merge-game fixture page and its manifest",
    async () => {
      const bin = await spawnBin([
        join(MERGE_GAME, "web", "index.html"),
        "--port",
        "0",
        "--root",
        MERGE_GAME
      ]);
      try {
        const origin = `http://127.0.0.1:${bin.port}`;
        const page = await fetch(`${origin}/`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('id="game"');
        await expect(fetch(`${origin}/manifest.json`)).resolves.toHaveProperty("status", 200);
        await expect(fetch(`${origin}/__editor/`)).resolves.toHaveProperty("status", 200);
        const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
        expect(hello.status).toBe(200);
      } finally {
        bin.child.kill("SIGINT");
      }
      expect(await bin.child.exited).toBe(0);
    },
    60_000
  );

  it("prints usage on --help (0) and refuses bad arguments with 2 (P14)", async () => {
    const help = await runBin(["--help"]);
    expect(help.code).toBe(0);
    expect(help.output).toContain("moku-editor <game-html>");
    const hostile = await runBin(["x.html", "--host", "0.0.0.0"]);
    expect(hostile.code).toBe(2);
  }, 30_000);

  it("exits 1 for a missing HTML file", async () => {
    const missing = await runBin([join(game, "nope.html"), "--port", "0"]);
    expect(missing.code).toBe(1);
    expect(missing.output).toContain("[moku-editor]");
  }, 30_000);
});
