import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { createServerCore, createServerPlugin, serverCoreConfig } from "../../../../config";
import type { FileBinary, FileText } from "../../../registry/protocol";
import { decodeDataUrl, filesPlugin } from "../..";
import type { FilesWritten } from "../../types";
import { PNG_BYTES } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// A server core composed with files and an audit plugin that hooks
// files:written. hub and pages join the core in later waves; this core keeps
// the files integration independent of them.
// ─────────────────────────────────────────────────────────────────────────────

/** Every files:written payload the audit plugin saw. */
const seen: FilesWritten[] = [];

/**
 * Records a files:written payload.
 *
 * @param payload - The event payload.
 */
function record(payload: FilesWritten): void {
  seen.push(payload);
}

/**
 * The hooks of the audit plugin.
 *
 * @returns The hook map.
 */
function auditHooks() {
  return { "files:written": record };
}

const auditPlugin = createServerPlugin("audit", {
  depends: [filesPlugin],
  hooks: auditHooks
});

const framework = createServerCore(serverCoreConfig, { plugins: [filesPlugin, auditPlugin] });

let base: string;
let root: string;

beforeEach(async () => {
  seen.length = 0;
  base = await mkdtemp(join(tmpdir(), "moku-files-"));
  root = join(base, "game");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/main.ts"), "export const a = 1;\n");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/**
 * Lets the fire-and-forget hooks run.
 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("files integration", () => {
  it("round-trips write and read with versions, conflicts on a stale one", async () => {
    const app = framework.createApp({ pluginConfigs: { files: { root } } });
    await app.start();

    expect(app.files.root()).toBe(await realpath(root));
    const first = await app.files.read("src/main.ts");
    const saved = await app.files.write("src/main.ts", "export const a = 2;\n", first.version);
    expect(saved.path).toBe("src/main.ts");
    const second = await app.files.read("src/main.ts");
    expect(second).toEqual({ text: "export const a = 2;\n", version: saved.version });

    await expect(app.files.write("src/main.ts", "x", first.version)).rejects.toMatchObject({
      code: -32_005
    });

    await settle();
    expect(seen).toEqual([{ path: "src/main.ts", bytes: 20, kind: "code" }]);
    await app.stop();
  });

  it("writes a decoded PNG into a missing series folder and reads it back", async () => {
    const app = framework.createApp({ pluginConfigs: { files: { root } } });
    await app.start();

    const path = ".moku/captures/series-x/001.png";
    const url = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
    const saved = await app.files.writeBinary(path, decodeDataUrl(url, path));
    const back = await app.files.readBinary(path);
    expect(back).toEqual({ dataUrl: url, version: saved.version });
    expect([...decodeDataUrl(back.dataUrl, path)]).toEqual([...PNG_BYTES]);

    await settle();
    expect(seen).toEqual([{ path, bytes: PNG_BYTES.length, kind: "capture" }]);
    const listed = await app.files.list(".moku/captures");
    expect(listed.map(entry => entry.path)).toEqual([".moku/captures/series-x"]);
    await app.stop();
  });

  it("throws from createApp on a missing root", () => {
    const missing = join(base, "missing");
    expect(() => framework.createApp({ pluginConfigs: { files: { root: missing } } })).toThrow(
      `files.root "${missing}" is not a directory.`
    );
  });

  it("types the app surface", () => {
    const app = framework.createApp({ pluginConfigs: { files: { root } } });
    expectTypeOf(app.files.read).returns.toEqualTypeOf<Promise<FileText>>();
    expectTypeOf(app.files.readBinary).returns.toEqualTypeOf<Promise<FileBinary>>();
    // @ts-expect-error — the state never leaks onto the app
    expect(app.files.state).toBeUndefined();
  });
});
