import { describe, expect, it, vi } from "vitest";
import type { FileText, ProjectFound, ProjectState } from "../../../registry/protocol";
import { wireError } from "../../../registry/protocol";
import {
  findAllFresh,
  findFresh,
  manifestOf,
  NOT_IN_INDEX_TEXT,
  notFoundText,
  projectOffText,
  textStylesFile,
  usedIn
} from "../../shared/project";

// ─────────────────────────────────────────────────────────────────────────────
// project.ts: what the views ask the project index. The index is the only
// source of code locations (amendment N): no crawl, no kebab rule, no list.
// ─────────────────────────────────────────────────────────────────────────────

const MERGE = "nodes/merge.ts";

/**
 * One answer of `find` for the merge node.
 *
 * @param line - The 1-based line.
 * @param hash - The sha1 of the bytes at the call.
 * @returns The Found.
 */
function foundAt(line: number, hash: string): ProjectFound {
  return { path: MERGE, binding: "merge", line, range: [line, 1, line + 12, 3], hash };
}

/**
 * An on state with the given maps.
 *
 * @param maps - The maps of the state.
 * @param maps.defs - Key → def paths.
 * @param maps.uses - Key → use paths.
 * @param maps.manifest - The manifest path, when found.
 * @returns The state.
 */
function on(maps: {
  defs?: Record<string, string[]>;
  uses?: Record<string, string[]>;
  manifest?: string;
}): ProjectState {
  const state: ProjectState = {
    state: "on",
    revision: "r1",
    defs: maps.defs ?? {},
    uses: maps.uses ?? {},
    broken: {}
  };
  return maps.manifest === undefined ? state : { ...state, manifest: maps.manifest };
}

const OFF: ProjectState = { state: "off", reason: "typescript is not installed" };

/**
 * A read that answers an empty file at version v1.
 *
 * @returns The text and version.
 */
async function readEmpty(): Promise<FileText> {
  return { text: "", version: "v1" };
}

/**
 * A find that rejects as a lost link does.
 *
 * @returns Never.
 */
async function findLost(): Promise<readonly ProjectFound[]> {
  throw wireError(-32_002, "timeout");
}

/**
 * A read of a file that is gone.
 *
 * @returns Never.
 */
async function readGone(): Promise<FileText> {
  throw wireError(-32_601, "unknown file");
}

/**
 * A find that knows no key.
 *
 * @returns No answer.
 */
async function findNothing(): Promise<readonly ProjectFound[]> {
  return [];
}

/**
 * A find that answers the merge node at line 17.
 *
 * @returns One answer.
 */
async function findMerge(): Promise<readonly ProjectFound[]> {
  return [foundAt(17, "v1")];
}

describe("findFresh", () => {
  it("answers the first Found with the text and version read now", async () => {
    const find = vi.fn(async () => [foundAt(17, "v1"), { ...foundAt(40, "v1"), path: "b.ts" }]);
    const read = vi.fn(async (): Promise<FileText> => ({ text: "merge", version: "v1" }));

    expect(await findFresh({ find, read }, "node:board/merge")).toEqual({
      found: foundAt(17, "v1"),
      text: "merge",
      version: "v1"
    });
    expect(find).toHaveBeenCalledWith("node:board/merge");
    expect(read).toHaveBeenCalledWith(MERGE);
  });

  it("asks once more when the file changed between find and read", async () => {
    const find = vi
      .fn<(key: string) => Promise<readonly ProjectFound[]>>()
      .mockResolvedValueOnce([foundAt(17, "v1")])
      .mockResolvedValueOnce([foundAt(20, "v2")]);
    const read = vi.fn(async (): Promise<FileText> => ({ text: "moved down", version: "v2" }));

    expect(await findFresh({ find, read }, "node:board/merge")).toEqual({
      found: foundAt(20, "v2"),
      text: "moved down",
      version: "v2"
    });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("asks once more only: a second mismatch answers the second Found with the read version", async () => {
    const find = vi
      .fn<(key: string) => Promise<readonly ProjectFound[]>>()
      .mockResolvedValueOnce([foundAt(17, "v1")])
      .mockResolvedValueOnce([foundAt(20, "v2")]);
    const read = vi
      .fn<(path: string) => Promise<FileText>>()
      .mockResolvedValueOnce({ text: "a", version: "v2" })
      .mockResolvedValueOnce({ text: "b", version: "v3" });

    expect(await findFresh({ find, read }, "node:board/merge")).toEqual({
      found: foundAt(20, "v2"),
      text: "b",
      version: "v3"
    });
    expect(find).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("answers undefined for a key the index does not know", async () => {
    const read = vi.fn(readEmpty);

    expect(await findFresh({ find: findNothing, read }, "jsx:cardRow")).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("never throws: a rejected find or read, or a client without find, answers undefined", async () => {
    const key = "node:board/merge";

    expect(await findFresh({ find: findLost, read: readEmpty }, key)).toBeUndefined();
    expect(await findFresh({ find: findMerge, read: readGone }, key)).toBeUndefined();
    expect(await findFresh({ read: readEmpty }, key)).toBeUndefined();
  });

  it("answers undefined when the second find comes back empty", async () => {
    const find = vi
      .fn<(key: string) => Promise<readonly ProjectFound[]>>()
      .mockResolvedValueOnce([foundAt(17, "v1")])
      .mockResolvedValueOnce([]);
    const read = vi.fn(async (): Promise<FileText> => ({ text: "", version: "v2" }));

    expect(await findFresh({ find, read }, "node:board/merge")).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("findAllFresh", () => {
  const KIT = "features/ui/kit.tsx";

  /**
   * One answer of `find` for a style call of the kit.
   *
   * @param line - The line of the call.
   * @param hash - The sha1 of the bytes at the call.
   * @returns The Found.
   */
  function callAt(line: number, hash: string): ProjectFound {
    return { path: KIT, binding: "signboardStyle", line, range: [line, 10, line + 4, 5], hash };
  }

  it("answers every Found in the file of the first one, with its text and version", async () => {
    const elsewhere = { ...callAt(9, "v1"), path: "features/ui/other.tsx" };
    const find = vi.fn(async () => [callAt(666, "v1"), elsewhere, callAt(668, "v1")]);
    const read = vi.fn(async (): Promise<FileText> => ({ text: "kit", version: "v1" }));

    expect(await findAllFresh({ find, read }, "style:features/ui/kit.tsx#signboardStyle")).toEqual({
      answers: [callAt(666, "v1"), callAt(668, "v1")],
      text: "kit",
      version: "v1"
    });
    expect(read).toHaveBeenCalledWith(KIT);
  });

  it("asks once more when the file changed between find and read", async () => {
    const find = vi
      .fn<(key: string) => Promise<readonly ProjectFound[]>>()
      .mockResolvedValueOnce([callAt(666, "v1")])
      .mockResolvedValueOnce([callAt(669, "v2"), callAt(671, "v2")]);
    const read = vi.fn(async (): Promise<FileText> => ({ text: "moved", version: "v2" }));

    expect(await findAllFresh({ find, read }, "style:features/ui/kit.tsx#signboardStyle")).toEqual({
      answers: [callAt(669, "v2"), callAt(671, "v2")],
      text: "moved",
      version: "v2"
    });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("never throws: no answer, a rejected find or read answer undefined", async () => {
    const key = "style:features/ui/kit.tsx#signboardStyle";

    expect(await findAllFresh({ find: findNothing, read: readEmpty }, key)).toBeUndefined();
    expect(await findAllFresh({ find: findLost, read: readEmpty }, key)).toBeUndefined();
    expect(await findAllFresh({ find: findMerge, read: readGone }, key)).toBeUndefined();
    expect(await findAllFresh({ read: readEmpty }, key)).toBeUndefined();
  });
});

describe("textStylesFile", () => {
  it("is the file with the most textStyle: keys", () => {
    const state = on({
      defs: {
        "textStyle:ui.title": ["features/ui/text-styles.ts"],
        "textStyle:ui.number": ["features/ui/text-styles.ts"],
        "textStyle:hud.coins": ["features/hud/text-styles.ts"],
        "node:board/merge": [MERGE]
      }
    });

    expect(textStylesFile(state)).toBe("features/ui/text-styles.ts");
  });

  it("takes the first path in sorted order on a tie, and counts both paths of a conflict", () => {
    const state = on({
      defs: {
        "textStyle:ui.title": ["z/styles.ts", "a/styles.ts"],
        "textStyle:hud.coins": ["z/styles.ts"],
        "textStyle:hud.lives": ["a/styles.ts"]
      }
    });

    expect(textStylesFile(state)).toBe("a/styles.ts");
  });

  it("is undefined with no textStyle: key, the index off or no state", () => {
    expect(textStylesFile(on({ defs: { "style:a.ts#row": ["a.ts"] } }))).toBeUndefined();
    expect(textStylesFile(OFF)).toBeUndefined();
    expect(textStylesFile(undefined)).toBeUndefined();
  });
});

describe("usedIn", () => {
  it("lists the files that use a key defined in the file, sorted, once, without the file", () => {
    const state = on({
      defs: {
        "node:board/merge": [MERGE],
        "node:board/catchUp": ["nodes/catch-up.ts"],
        "style:nodes/merge.ts#row": [MERGE]
      },
      uses: {
        "node:board/merge": ["flows/board.ts", MERGE],
        "style:nodes/merge.ts#row": ["features/ui/popup.tsx", "flows/board.ts"],
        "node:board/catchUp": ["flows/other.ts"]
      }
    });

    expect(usedIn(state, MERGE)).toEqual(["features/ui/popup.tsx", "flows/board.ts"]);
  });

  it("is empty for a file that defines nothing used, the index off or no state", () => {
    expect(usedIn(on({ defs: { "node:a": ["a.ts"] } }), "a.ts")).toEqual([]);
    expect(usedIn(OFF, MERGE)).toEqual([]);
    expect(usedIn(undefined, MERGE)).toEqual([]);
  });
});

describe("manifestOf", () => {
  it("is the manifest of an on state, else undefined", () => {
    expect(manifestOf(on({ manifest: "public/manifest.json" }))).toBe("public/manifest.json");
    expect(manifestOf(on({}))).toBeUndefined();
    expect(manifestOf(OFF)).toBeUndefined();
    expect(manifestOf(undefined)).toBeUndefined();
  });
});

describe("shared texts", () => {
  it("names the reason the index is off, once per view", () => {
    expect(projectOffText(OFF)).toBe("Project index is off: typescript is not installed");
    expect(projectOffText(undefined)).toBe("Project index is off: no state from the server yet");
    expect(projectOffText(on({}))).toBeUndefined();
  });

  it("says a key is not in the index, or why the index cannot say", () => {
    expect(NOT_IN_INDEX_TEXT).toBe("Not in the project index");
    expect(notFoundText(on({}), "jsx:cardRow")).toBe("Not in the project index: jsx:cardRow");
    expect(notFoundText(OFF, "jsx:cardRow")).toBe(
      "Project index is off: typescript is not installed"
    );
  });
});
