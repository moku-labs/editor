import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createServerCore, createServerPlugin, serverCoreConfig } from "../../../../config";
import type { FileBinary, FileText, ProjectFound, ProjectState } from "../../../registry/protocol";
import { filesPlugin } from "../..";
import { decodeDataUrl } from "../../binary";
import type { FilesWritten } from "../../types";
import { MINI_GAME, PNG_BYTES } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// A server core composed with files and an audit plugin that hooks
// files:written and files:project. hub and pages join the core in later waves;
// this core keeps the files integration independent of them.
// ─────────────────────────────────────────────────────────────────────────────

/** Every files:written payload the audit plugin saw. */
const seen: FilesWritten[] = [];

/** Every files:project payload the audit plugin saw. */
const announced: ProjectState[] = [];

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
  return {
    "files:written": record,
    "files:project": (state: ProjectState) => {
      announced.push(state);
    }
  };
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
  announced.length = 0;
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
    const saved = await app.files.writeDataUrl(path, url);
    const back = await app.files.readBinary(path);
    expect(back).toEqual({ dataUrl: url, version: saved.version });
    expect([...decodeDataUrl(back.dataUrl, path)]).toEqual([...PNG_BYTES]);

    await settle();
    expect(seen).toEqual([{ path, bytes: PNG_BYTES.length, kind: "capture" }]);
    const listed = await app.files.list(".moku/captures");
    expect(listed.map(entry => entry.path)).toEqual([".moku/captures/series-x"]);
    await app.stop();
  });

  it("opens the project index on start, finds keys and closes it on stop", async () => {
    await Promise.all(
      Object.entries(MINI_GAME).map(async ([path, text]) => {
        await mkdir(join(root, path, ".."), { recursive: true });
        await writeFile(join(root, path), text);
      })
    );
    const app = framework.createApp({ pluginConfigs: { files: { root } } });
    await app.start();

    const found: ProjectFound[] = await app.files.find("node:main/open");
    expect(found).toMatchObject([{ path: "features/settings/nodes.ts", line: 3 }]);
    await vi.waitFor(() => expect(announced).toHaveLength(1));
    expect(announced[0]).toMatchObject({ state: "on", defs: { "flow:main": ["flows/main.ts"] } });
    expect(app.files.project()).toEqual(announced[0]);

    await app.stop();
    expect(app.files.project()).toEqual({ state: "off", reason: "stopped" });
    expect(announced).toHaveLength(1);
  });

  it("stays off as disabled with files.project false and keeps the files working", async () => {
    const app = framework.createApp({ pluginConfigs: { files: { root, project: false } } });
    await app.start();

    await expect(app.files.find("flow:main")).rejects.toMatchObject({ code: -32_008 });
    expect(announced).toEqual([{ state: "off", reason: "disabled" }]);
    await expect(app.files.read("src/main.ts")).resolves.toHaveProperty("text");
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
    expectTypeOf(app.files.find).returns.toEqualTypeOf<Promise<ProjectFound[]>>();
    expectTypeOf(app.files.project).returns.toEqualTypeOf<ProjectState>();
    // @ts-expect-error — the state never leaks onto the app
    expect(app.files.state).toBeUndefined();
  });
});
