import { describe, expect, it } from "vitest";
import type { FileEntry, FileText } from "../../../registry/protocol";
import {
  callsDefiner,
  findStylesFile,
  type StylesFileFiles,
  splitFolder
} from "../../shared/styles-file";

const DEFINES = 'export const textStyles = defineTextStyles({\n  "ui.number": { size: 60 }\n});\n';

/**
 * An in-memory files client whose listing names folders too.
 *
 * @param files - Path to text.
 * @returns The client.
 */
function filesOf(files: Readonly<Record<string, string>>): StylesFileFiles {
  return {
    list(dir: string): Promise<readonly FileEntry[]> {
      const prefix = dir === "" ? "" : `${dir}/`;
      const folders = new Set<string>();
      const entries: FileEntry[] = [];
      for (const [path, text] of Object.entries(files)) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) entries.push({ path, kind: "file", size: text.length });
        else folders.add(`${prefix}${rest.slice(0, slash)}`);
      }
      const dirs = [...folders].map((path): FileEntry => ({ path, kind: "dir", size: 0 }));
      return Promise.resolve([...dirs, ...entries]);
    },
    read(path: string): Promise<FileText> {
      const text = files[path];
      return text === undefined
        ? Promise.reject(new Error(`no file ${path}`))
        : Promise.resolve({ text, version: "v1" });
    }
  };
}

describe("callsDefiner", () => {
  it("counts a call on a line of code, not a comment or the definer's own definition", () => {
    expect(callsDefiner(DEFINES)).toBe(true);
    expect(callsDefiner('const styles = kit.defineTextStyles({ "a": {} });')).toBe(true);
    expect(callsDefiner(" * defineTextStyles({ a: {} });\n// defineTextStyles(")).toBe(false);
    expect(callsDefiner("export function defineTextStyles(map: Record<string, unknown>) {")).toBe(
      false
    );
    expect(callsDefiner("const x = undefineTextStyles(1);")).toBe(false);
  });
});

describe("splitFolder", () => {
  it("keeps source files in listing order and the folders the search enters", () => {
    expect(
      splitFolder([
        { path: "src", kind: "dir", size: 0 },
        { path: "a.ts", kind: "file", size: 1 },
        { path: "b.md", kind: "file", size: 1 },
        { path: "node_modules", kind: "dir", size: 0 },
        { path: "x/dist", kind: "dir", size: 0 }
      ])
    ).toEqual({ sources: ["a.ts"], folders: ["src"] });
  });
});

describe("findStylesFile", () => {
  it("finds the first file that calls the definer, breadth-first, skipping dependencies", async () => {
    const files = filesOf({
      "node_modules/kit/styles.ts": DEFINES,
      "src/deep/more/styles.ts": DEFINES,
      "src/ui/styles.ts": DEFINES,
      "src/kit.ts": "export function defineTextStyles(map) {}\n"
    });
    expect(await findStylesFile(files)).toBe("src/ui/styles.ts");
  });

  it("is undefined when no file calls the definer or a read fails", async () => {
    expect(await findStylesFile(filesOf({ "a.ts": "const a = 1;" }))).toBeUndefined();
    const broken: StylesFileFiles = {
      list: () => Promise.reject(new Error("offline")),
      read: () => Promise.reject(new Error("offline"))
    };
    expect(await findStylesFile(broken)).toBeUndefined();
  });
});
