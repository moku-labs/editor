import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processPerfDeps } from "../../deps";
import { noGamePage } from "../../home";
import { removeRoot, tempRoot, writeIn } from "../helpers";

let root: string;

beforeEach(async () => {
  root = await tempRoot();
});

afterEach(async () => {
  await removeRoot(root);
});

describe("processPerfDeps", () => {
  it("reads the game's base identifier from config.ts, so gfx lines can find the app", async () => {
    await writeIn(
      root,
      "config.ts",
      'export default { native: { identifier: "com.example.garden" } };\n'
    );
    await expect(processPerfDeps().appIdOf(root)).resolves.toBe("com.example.garden");
  });

  it("answers no app id without config.ts, for a config.ts that throws, and without an identifier", async () => {
    const deps = processPerfDeps();
    await expect(deps.appIdOf(root)).resolves.toBeUndefined();
    await writeIn(root, "config.ts", 'throw new Error("broken");\n');
    await expect(deps.appIdOf(root)).resolves.toBeUndefined();
    const other = await tempRoot();
    await writeIn(other, "config.ts", "export default { native: {} };\n");
    await expect(deps.appIdOf(other)).resolves.toBeUndefined();
    await removeRoot(other);
  });

  it("tells this process alive and an impossible pid gone", () => {
    const deps = processPerfDeps();
    expect(deps.isAlive(process.pid)).toBe(true);
    expect(deps.isAlive(-1)).toBe(false);
    expect(deps.isAlive(2 ** 30)).toBe(false);
  });

  it("reads a text file and rejects a missing one", async () => {
    const path = await writeIn(root, "a.jsonl", "line\n");
    const deps = processPerfDeps();
    await expect(deps.readText(path)).resolves.toBe("line\n");
    await expect(deps.readText(`${root}/none`)).rejects.toThrow();
  });
});

describe("noGamePage", () => {
  it("answers a sentence instead of a 404, with no script allowed and no cache", async () => {
    const page = noGamePage();
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await page.text()).toBe(
      "<!doctype html><title>moku-editor perf</title><p>No game is served here. Phones connect to this port; the tools page shows them in its device strip.</p>"
    );
  });
});
