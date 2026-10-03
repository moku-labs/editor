import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CliDeps, PageModule } from "../../cli";
import { main, startBin, stopOnce } from "../../cli";

/** The default fake HTML bundle. */
const GAME_PAGE: PageModule = { default: new Response("<p>game</p>") };

let game: string;

beforeAll(async () => {
  game = await realpath(await mkdtemp(join(tmpdir(), "moku-cli-")));
  await writeFile(join(game, "index.html"), "<html></html>");
  await writeFile(join(game, "data.json"), "{}");
});

afterAll(async () => {
  await rm(game, { recursive: true, force: true });
});

/**
 * Bin deps that record every console line and fake the HTML import.
 *
 * @param page - What the HTML import resolves with.
 * @returns The deps and the recorded lines.
 */
function createDeps(page: PageModule | Error = GAME_PAGE) {
  const lines: string[] = [];
  const ui = createBrandConsole({
    write: line => lines.push(line),
    writeError: line => lines.push(line),
    color: false
  });
  const deps: CliDeps = {
    ui,
    importPage: vi.fn(() => (page instanceof Error ? Promise.reject(page) : Promise.resolve(page))),
    exit: vi.fn()
  };
  return { deps, lines };
}

describe("startBin", () => {
  it("prints usage with 0 for --help", async () => {
    const { deps, lines } = createDeps();
    await expect(startBin(["--help"], deps)).resolves.toHaveProperty("code", 0);
    expect(lines.join("\n")).toContain("moku-editor <game-html>");
  });

  it("prints the error and usage with 2 for bad arguments", async () => {
    const { deps, lines } = createDeps();
    await expect(startBin(["x.html", "--host", "0.0.0.0"], deps)).resolves.toHaveProperty(
      "code",
      2
    );
    expect(lines.join("\n")).toContain("[moku-editor]");
  });

  it("answers 1 for a missing HTML file, a failed import and a non-bundle", async () => {
    const missing = createDeps();
    await expect(startBin([join(game, "nope.html")], missing.deps)).resolves.toHaveProperty(
      "code",
      1
    );
    const failing = createDeps(new Error("parse error"));
    await expect(startBin([join(game, "index.html")], failing.deps)).resolves.toHaveProperty(
      "code",
      1
    );
    expect(failing.lines.join("\n")).toContain("parse error");
    const empty = createDeps({});
    await expect(startBin([join(game, "index.html")], empty.deps)).resolves.toHaveProperty(
      "code",
      1
    );
  });

  it("answers 1 when the root cannot start the editor", async () => {
    const { deps, lines } = createDeps();
    const started = await startBin(
      [join(game, "index.html"), "--root", join(game, "missing")],
      deps
    );
    expect(started.code).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("serves the game, files and editor, prints URLs without the token, and stops", async () => {
    const { deps, lines } = createDeps();
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", game], deps);
    expect(started.code).toBe(0);
    const port = Number(/127\.0\.0\.1:(\d+)\//.exec(lines.join("\n"))?.[1]);
    const origin = `http://127.0.0.1:${port}`;
    try {
      const page = await fetch(`${origin}/`);
      expect(await page.text()).toBe("<p>game</p>");
      const data = await fetch(`${origin}/data.json`);
      expect(data.status).toBe(200);
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      const body: { token: string } = await hello.json();
      expect(lines.join("\n")).not.toContain(body.token);
      expect(lines.join("\n")).toContain(`Tools  ${origin}/__editor/`);

      const second = createDeps();
      const busy = await startBin(
        [join(game, "index.html"), "--port", String(port), "--root", game],
        second.deps
      );
      expect(busy.code).toBe(1);
      expect(second.lines.join("\n")).toContain(`is in use · try --port ${port + 1}`);
    } finally {
      await started.stop?.();
    }
  });
});

describe("main", () => {
  it("resolves with the code and stops on SIGINT while serving", async () => {
    expect(await main(["--help"], createDeps().deps)).toBe(0);
    const { deps, lines } = createDeps();
    expect(await main([join(game, "index.html"), "--port", "0", "--root", game], deps)).toBe(0);
    process.emit("SIGINT");
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(lines.join("\n")).toContain("stopped");
    process.emit("SIGTERM");
  });
});

describe("stopOnce", () => {
  it("stops once, prints stopped and exits 0", async () => {
    const { deps, lines } = createDeps();
    const stop = vi.fn(() => Promise.resolve());
    const onSignal = stopOnce(stop, deps);
    await onSignal();
    await onSignal();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(lines.join("\n")).toContain("stopped");
  });

  it("prints a stop failure and still exits 0", async () => {
    const { deps, lines } = createDeps();
    await stopOnce(() => Promise.reject(new Error("boom")), deps)();
    expect(lines.join("\n")).toContain("boom");
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});
