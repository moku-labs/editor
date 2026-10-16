/**
 * @file recorder store — the memory store: every log as its chunks of text in a Map. Used when the
 * page has no OPFS, with `storage: "memory"`, and for a log whose OPFS writes failed. `remove`
 * deletes before its first await, so `memoryBytes` drops at once (the keepMb loop reads it right
 * after).
 */
import type { LogFileInfo } from "../types";
import type { LogStore } from "./types";

/** The MIME type of a log file. */
export const NDJSON = "application/x-ndjson";

/** One log of the memory store. */
type MemoryLog = { info: LogFileInfo; readonly chunks: string[] };

/**
 * Creates an empty memory store.
 *
 * @returns The store; `memoryBytes` is the sum of the text lengths of its chunks.
 */
export function createMemoryStore(): LogStore {
  const logs = new Map<string, MemoryLog>();
  let bytes = 0;

  return {
    kind: "memory",
    list: async () =>
      [...logs.values()].map(log => ({ ...log.info, current: false, storage: "memory" as const })),
    append: async (info, text) => {
      const log = logs.get(info.name);
      if (log === undefined) logs.set(info.name, { info, chunks: [text] });
      else {
        log.info = info;
        log.chunks.push(text);
      }
      bytes += text.length;
    },
    describe: async info => {
      const log = logs.get(info.name);
      if (log === undefined) logs.set(info.name, { info, chunks: [] });
      else log.info = info;
    },
    read: async name => new Blob(logs.get(name)?.chunks ?? [], { type: NDJSON }),
    remove: async name => {
      for (const chunk of logs.get(name)?.chunks ?? []) bytes -= chunk.length;
      logs.delete(name);
    },
    memoryBytes: () => bytes
  };
}
