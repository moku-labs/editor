import { describe, expect, it, vi } from "vitest";
import { readManifest } from "../../scene/manifest";
import { createCtx, projectOn } from "../helpers";

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
  it("reads the manifest the project index names and caches it", async () => {
    const ctx = createCtx({ "public/manifest.json": MANIFEST, "manifest.json": MANIFEST });
    ctx.link.projectValue = projectOn({}, { manifest: "public/manifest.json" });
    const read = vi.spyOn(ctx.link.files, "read");

    const catalogue = await readManifest(ctx);
    await readManifest(ctx);

    expect(catalogue?.path).toBe("public/manifest.json");
    expect(catalogue?.textures.get("board.cell")?.gpuMb).toBe(4);
    expect([...(catalogue?.textures.keys() ?? [])]).toEqual(["board.cell"]);
    expect(ctx.state.manifest).toBe(catalogue);
    expect(read.mock.calls).toEqual([["public/manifest.json"]]);
  });

  it("is undefined without a manifest from the index, and remembers that (null)", async () => {
    const ctx = createCtx({ "manifest.json": MANIFEST });
    expect(await readManifest(ctx)).toBeUndefined();
    expect(ctx.state.manifest).toBeNull();

    ctx.link.projectValue = projectOn({}, { manifest: "manifest.json" });
    expect(await readManifest(ctx)).toBeUndefined();
  });

  it("reads no file while the index is off or has sent no state", async () => {
    const ctx = createCtx({ "manifest.json": MANIFEST });
    const read = vi.spyOn(ctx.link.files, "read");
    ctx.link.projectValue = { state: "off", reason: "disabled" };
    expect(await readManifest(ctx)).toBeUndefined();

    ctx.state.manifest = undefined;
    ctx.link.projectValue = undefined;
    expect(await readManifest(ctx)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("is undefined when the named manifest is missing or not a version-1 manifest", async () => {
    const ctx = createCtx({ "manifest.json": "{ nope" });
    ctx.link.projectValue = projectOn({}, { manifest: "manifest.json" });
    expect(await readManifest(ctx)).toBeUndefined();

    ctx.state.manifest = undefined;
    ctx.link.projectValue = projectOn({}, { manifest: "web/manifest.json" });
    expect(await readManifest(ctx)).toBeUndefined();
    expect(ctx.state.manifest).toBeNull();
  });
});
