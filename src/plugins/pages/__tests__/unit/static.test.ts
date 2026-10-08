import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { guard } from "../../../hub/security/guard";
import { createStaticFetch } from "../../static";
import { request, SERVER } from "../helpers";

let base: string;
let root: string;
let fetchStatic: ReturnType<typeof createStaticFetch>;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "moku-static-")));
  root = join(base, "game");
  await mkdir(join(root, "features", "board"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, ".moku", "captures"), { recursive: true });
  await mkdir(join(root, "node_modules", "x"), { recursive: true });
  await writeFile(join(root, "manifest.json"), '{"a":1}');
  await writeFile(join(root, "features", "board", "tile 1.png"), new Uint8Array([1, 2, 3]));
  await writeFile(join(root, ".env"), "SECRET=1");
  await writeFile(join(root, ".git", "config"), "x");
  await writeFile(join(root, ".moku", "captures", "a.png"), "x");
  await writeFile(join(root, "node_modules", "x", "index.js"), "x");
  await writeFile(join(base, "outside.txt"), "outside");
  await symlink(join(base, "outside.txt"), join(root, "escape.txt"));
  await symlink(join(root, "manifest.json"), join(root, "inside.json"));
  fetchStatic = createStaticFetch(root, (req, server, mode) => guard(req, server, mode, new Set()));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

/**
 * A game folder with the manifests asked for, and the fetch over it.
 *
 * @param manifests - The files to write, by path relative to the game.
 * @param folders - Folders to make, by path relative to the game.
 * @returns The fetch.
 */
async function gameWith(
  manifests: Record<string, string>,
  folders: readonly string[] = []
): Promise<ReturnType<typeof createStaticFetch>> {
  const game = await realpath(await mkdtemp(join(base, "manifest-")));
  await mkdir(join(game, "generated"), { recursive: true });
  for (const folder of folders) await mkdir(join(game, folder), { recursive: true });
  for (const [file, text] of Object.entries(manifests)) await writeFile(join(game, file), text);
  return createStaticFetch(game, (req, server, mode) => guard(req, server, mode, new Set()));
}

describe("createStaticFetch", () => {
  it("serves a real file with type, no-cache and nosniff", async () => {
    const response = await fetchStatic(request("/manifest.json"), SERVER);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe('{"a":1}');
  });

  it("decodes the path and serves binary files", async () => {
    const response = await fetchStatic(request("/features/board/tile%201.png"), SERVER);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("follows a symlink that stays inside the root", async () => {
    const response = await fetchStatic(request("/inside.json"), SERVER);
    expect(response.status).toBe(200);
  });

  it("answers HEAD without a body", async () => {
    const response = await fetchStatic(request("/manifest.json", { method: "HEAD" }), SERVER);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("P11: refuses dotfiles, node_modules, traversal, folders and symlinks out of root", async () => {
    const paths = [
      "/.env",
      "/.git/config",
      "/.moku/captures/a.png",
      "/node_modules/x/index.js",
      "/%2e%2e/outside.txt",
      "/features/%2e%2e/%2e%2e/outside.txt",
      "/features%2f..%2f..%2foutside.txt",
      "/escape.txt",
      "/features",
      "/",
      "/missing.json",
      "/a%00.json",
      "/a%5c..%5coutside.txt"
    ];
    for (const path of paths) {
      const response = await fetchStatic(request(path), SERVER);
      expect(response.status, path).toBe(404);
    }
  });

  it("answers 400 for a malformed escape and 405 for other methods", async () => {
    await expect(fetchStatic(request("/%E0%A4%A"), SERVER)).resolves.toHaveProperty("status", 400);
    const post = await fetchStatic(request("/manifest.json", { method: "POST" }), SERVER);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("P12: passes the guard refusal through (Host evil.com)", async () => {
    const response = await fetchStatic(
      request("/manifest.json", { headers: { host: "evil.com:4000" } }),
      SERVER
    );
    expect(response.status).toBe(403);
  });

  it("checks with the navigate mode", async () => {
    const spy = vi.fn(() => undefined);
    const fetcher = createStaticFetch(root, spy);
    const manifest = request("/manifest.json");
    await fetcher(manifest, SERVER);
    expect(spy).toHaveBeenCalledWith(manifest, SERVER, "navigate");
  });

  describe("/manifest.json (game 0.13: generated/manifest.json)", () => {
    it("answers from generated/manifest.json when only that one exists", async () => {
      const serve = await gameWith({ "generated/manifest.json": '{"at":"generated"}' });
      const response = await serve(request("/manifest.json"), SERVER);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await response.text()).toBe('{"at":"generated"}');
    });

    it("falls back to the root's manifest.json in an older game", async () => {
      const serve = await gameWith({ "manifest.json": '{"at":"root"}' });
      const response = await serve(request("/manifest.json"), SERVER);
      expect(await response.text()).toBe('{"at":"root"}');
    });

    it("prefers generated/manifest.json when both exist; the generated path still serves itself", async () => {
      const serve = await gameWith({
        "manifest.json": '{"at":"root"}',
        "generated/manifest.json": '{"at":"generated"}'
      });
      const response = await serve(request("/manifest.json"), SERVER);
      expect(await response.text()).toBe('{"at":"generated"}');
      const direct = await serve(request("/generated/manifest.json"), SERVER);
      expect(await direct.text()).toBe('{"at":"generated"}');
    });

    it("falls back to the root's manifest when generated/manifest.json is not a file", async () => {
      const serve = await gameWith({ "manifest.json": '{"at":"root"}' }, [
        "generated/manifest.json"
      ]);
      const response = await serve(request("/manifest.json"), SERVER);
      expect(await response.text()).toBe('{"at":"root"}');
    });

    it("answers 404 when neither exists", async () => {
      const serve = await gameWith({});
      const response = await serve(request("/manifest.json"), SERVER);
      expect(response.status).toBe(404);
    });
  });

  it("answers 404 for every path when the root does not exist", async () => {
    const fetcher = createStaticFetch(join(base, "nope"), () => undefined);
    await expect(fetcher(request("/manifest.json"), SERVER)).resolves.toHaveProperty("status", 404);
  });
});
