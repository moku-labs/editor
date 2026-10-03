import { describe, expect, it } from "vitest";
import { readManifest } from "../../scene/manifest";
import { createCtx } from "../helpers";

const MANIFEST = JSON.stringify({
  version: 1,
  bundles: {
    board: {
      tier: "scene",
      mb: 4,
      files: [
        { key: "board.cell", path: "cell.webp", width: 1024, height: 1024, mb: 4 },
        { key: "font.main", kind: "font", path: "main.woff2", mb: 0.1 }
      ]
    }
  }
});

describe("readManifest", () => {
  it("reads the first readable manifestPaths entry and caches it for the session", async () => {
    const ctx = createCtx({ "public/manifest.json": MANIFEST });

    const catalogue = await readManifest(ctx);
    await readManifest(ctx);

    expect(catalogue?.path).toBe("public/manifest.json");
    expect(catalogue?.textures.get("board.cell")?.gpuMb).toBe(4);
    expect([...(catalogue?.textures.keys() ?? [])]).toEqual(["board.cell"]);
    expect(ctx.state.manifest).toBe(catalogue);
  });

  it("skips a file that is not a version-1 manifest", async () => {
    const ctx = createCtx({ "manifest.json": "{ nope", "web/manifest.json": MANIFEST });
    const catalogue = await readManifest(ctx);
    expect(catalogue?.path).toBe("web/manifest.json");
  });

  it("is undefined when none is found, and remembers that (null)", async () => {
    const ctx = createCtx();
    expect(await readManifest(ctx)).toBeUndefined();
    expect(ctx.state.manifest).toBeNull();
    ctx.link.files.put("manifest.json", MANIFEST);
    expect(await readManifest(ctx)).toBeUndefined();
  });
});
