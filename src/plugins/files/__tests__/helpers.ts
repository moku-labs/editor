import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path/posix";
import type { Mock } from "vitest";
import { vi } from "vitest";
import { createFilesApi } from "../api";
import { validateFilesConfig } from "../init";
import { createFilesState } from "../state";
import type { FilesApi, FilesConfig, FilesCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of files: a temp project root, a sibling folder outside
// the root, a mock log and a domain ctx initialised by the real onInit body.
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of the plugin (same values as index.ts). */
export const DEFAULT_CONFIG: FilesConfig = {
  root: ".",
  allow: ["**/*.ts", "**/*.tsx", "**/*.json", "**/*.md", "**/*.css", ".moku/**"],
  deny: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.env*"]
};

/** A 1x1 transparent PNG. */
export const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  )
);

/**
 * A full Log.LogApi made of mocks.
 *
 * @returns The mock log.
 */
export function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(() => []),
    expect: vi.fn(),
    addSink: vi.fn(),
    reset: vi.fn(),
    clearSinks: vi.fn()
  };
}

/**
 * A typed mock of the files emit.
 *
 * @returns The mock.
 */
export function createEmit(): Mock<FilesCtx["emit"]> {
  return vi.fn<FilesCtx["emit"]>();
}

/** A files ctx whose emit and log are mocks. */
export type TestCtx = FilesCtx & {
  readonly emit: Mock<FilesCtx["emit"]>;
  readonly log: ReturnType<typeof createLog>;
};

/** A temp project root with its api. */
export type Fixture = {
  /** The root as created (may contain a symlink, e.g. /var → /private/var). */
  readonly root: string;
  /** The real root. */
  readonly rootReal: string;
  /** A folder next to the root, outside the sandbox. */
  readonly outside: string;
  readonly ctx: TestCtx;
  readonly api: FilesApi;
  /** Writes a file (parents created) relative to the root. */
  put(relative: string, content?: string | Uint8Array): Promise<string>;
  /** Writes a file (parents created) relative to the outside folder. */
  putOutside(relative: string, content?: string | Uint8Array): Promise<string>;
  /** Creates a symlink at `relative` (inside the root) pointing at `target` (absolute). */
  link(relative: string, target: string): Promise<void>;
  /** Removes the root and the outside folder. */
  cleanup(): Promise<void>;
};

/**
 * Writes a file, creating its parents.
 *
 * @param file - Absolute path.
 * @param content - Text or bytes.
 * @returns The absolute path.
 */
async function writeAt(file: string, content: string | Uint8Array): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

/**
 * Creates a fresh temp root (and an outside folder), a ctx and the api.
 *
 * @param config - Config overrides (root is always the temp root).
 * @returns The fixture.
 */
export async function createFixture(config: Partial<FilesConfig> = {}): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "moku-files-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);

  const ctx: TestCtx = {
    config: { ...DEFAULT_CONFIG, ...config, root },
    state: createFilesState(),
    emit: createEmit(),
    log: createLog()
  };
  validateFilesConfig(ctx);

  return {
    root,
    rootReal: await realpath(root),
    outside,
    ctx,
    api: createFilesApi(ctx),
    put: (relative, content = `// ${relative}\n`) => writeAt(join(root, relative), content),
    putOutside: (relative, content = `// ${relative}\n`) =>
      writeAt(join(outside, relative), content),
    link: async (relative, target) => {
      await mkdir(dirname(join(root, relative)), { recursive: true });
      await symlink(target, join(root, relative));
    },
    cleanup: () => rm(base, { recursive: true, force: true })
  };
}

/**
 * Settles a promise into its error code, or "ok".
 *
 * @param promise - The call.
 * @returns The rejection code or "ok".
 */
export async function outcome(promise: Promise<unknown>): Promise<number | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      return typeof error.code === "number" ? error.code : -1;
    }
    return -1;
  }
}
