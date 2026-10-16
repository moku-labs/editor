/**
 * @file recorder store — the barrel and `openStore`: OPFS when the config asks for "auto", the page
 * has `navigator.storage.getDirectory` and opening the directory works; memory otherwise, with the
 * reason.
 */
import { createMemoryStore } from "./memory";
import { createOpfsStore, OPFS_DIR } from "./opfs";
import type { DirectoryHandleLike, OpenedStore } from "./types";

export { createMemoryStore, NDJSON } from "./memory";
export { createOpfsStore, OPFS_DIR } from "./opfs";
export type { LogStore, OpenedStore } from "./types";

/**
 * The page's `navigator.storage.getDirectory`, bound; undefined when the page has none.
 *
 * @returns The opener of the OPFS root.
 */
function directoryOpener(): (() => Promise<unknown>) | undefined {
  const storage: unknown = Reflect.get(Object(Reflect.get(globalThis, "navigator")), "storage");
  const getDirectory: unknown = Reflect.get(Object(storage), "getDirectory");
  if (typeof getDirectory !== "function") return undefined;
  return async () => Reflect.apply(getDirectory, storage, []);
}

/**
 * The message of anything thrown.
 *
 * @param error - A thrown value.
 * @returns Its message, or its text.
 * @example
 * ```ts
 * messageOf(new Error("SecurityError: denied")); // "SecurityError: denied"
 * ```
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens the store the config asks for.
 *
 * @param storage - The config's storage.
 * @returns The store and, when OPFS was wanted but not used, why.
 */
export async function openStore(storage: "auto" | "memory"): Promise<OpenedStore> {
  if (storage === "memory") return { store: createMemoryStore() };

  const open = directoryOpener();
  if (open === undefined) {
    return {
      store: createMemoryStore(),
      reason: "the page has no navigator.storage.getDirectory"
    };
  }

  try {
    // boundary: the page's OPFS root, used through its structural shape
    const top = (await open()) as DirectoryHandleLike;
    const root = await top.getDirectoryHandle(OPFS_DIR, { create: true });
    return { store: createOpfsStore(root) };
  } catch (error) {
    return { store: createMemoryStore(), reason: `OPFS did not open: ${messageOf(error)}` };
  }
}
