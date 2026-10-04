/**
 * @file The edit loop (round 2 R7): how fast a change made from a reference block shows in the
 * game, on the merge-game copy the bin serves with Bun hot reload on (its default, D-23).
 *
 * Five scripted edits, each the way an agent in the chat works: pick the element (a click on its
 * Reference mode proxy), read the reference block off the clipboard, derive the edit only from
 * the block (its `source`, `style`, `texture`, `layout` and `bounds` lines, then the code those
 * lines point to), write the file on disk with `fs` (not through the editor), and measure the ms
 * from the save until the game page shows the new value with its state restored:
 *
 * 1. move homeCoins 20 px: the padding of its parent row (`layout`), scaled px → reference units
 *    with the `bounds` line; `game.rect` x moves by 20 px;
 * 2. resize the Play button: the width and height of its style block (`style`) set 10 % over its
 *    reference size (`bounds … ref`); `game.rect` w and h follow;
 * 3. recolour a text style: the `fill` of the text style the label's source line names; the
 *    label's pixels in a `game.capture` frame turn the new colour;
 * 4. change a text style size: the `size` of that text style; `game.rect` of the label scales;
 * 5. swap a texture: the button's nine-slice (`texture`) for another one of its bundle in its
 *    style block; the button's style in `game.ui` and a `NineSlice` in `game.entities` name it.
 *
 * Before each edit the game commits a marker (`session.taps`); "restored" means the reloaded page
 * holds the marker again and stands on home, which a fresh start would not. A row is a first-try
 * success when the first edit derived from the block shows its value within 10 s. The spec prints
 * the table, attaches it as edit-loop.json, fails on any edit above 1500 ms, and writes every
 * game file back afterwards. It runs in the desktop project only: the loop does not depend on the
 * window.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The slowest save → frame the spec accepts, in ms (target < 1000). */
const LIMIT_MS = 1500;

/** How long one edit may take to show before it counts as failed, in ms. */
const GIVE_UP_MS = 10_000;

/** The colour the recolour edit gives the text style, as RGB. */
const NEW_FILL: readonly [number, number, number] = [0x00, 0xc8, 0xff];

/** Game-frame warnings a reload provokes that are not editor defects (see flow.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** A rect in px or reference units. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** One parent of the block's `layout` line. */
type LayoutParent = {
  readonly name: string;
  readonly direction: string | undefined;
  readonly fields: ReadonlyMap<string, readonly number[]>;
};

/** What the spec reads of a reference block. */
type Block = {
  readonly text: string;
  readonly name: string;
  readonly source: { readonly file: string; readonly line: number } | undefined;
  readonly style:
    | { readonly name: string; readonly file: string; readonly line: number }
    | undefined;
  readonly texture: string | undefined;
  readonly layout: readonly LayoutParent[];
  readonly px: Rect;
  readonly ref: Rect;
};

/** What the game page shows of one element, read in one go. */
type Probe = {
  readonly rect: Rect | undefined;
  readonly taps: number;
  readonly path: string;
  readonly nineSlice: string | undefined;
  readonly entityTexture: boolean;
  readonly share: number | undefined;
};

/** What a probe also reads for one edit. */
type ProbeOptions = {
  readonly texture?: string;
  readonly colour?: readonly [number, number, number];
};

/** A file change derived from a block, and what the game must show after it. */
type Edit = {
  readonly file: string;
  readonly next: string;
  readonly what: string;
  readonly options: ProbeOptions;
  readonly shows: (probe: Probe) => boolean;
};

/** One scripted edit: the element it picks and how it derives its change from the block. */
type Script = {
  readonly title: string;
  readonly key: string;
  readonly derive: (block: Block, before: Probe) => Promise<Edit>;
};

/** One row of the result table. */
type Row = {
  readonly edit: string;
  readonly change: string;
  readonly firstTry: boolean;
  readonly ms: number | undefined;
};

// ---------------------------------------------------------------------------------------------
// The game page
// ---------------------------------------------------------------------------------------------

/**
 * The game page frame.
 *
 * @param page - The test page.
 * @returns The frame.
 */
function gameFrame(page: Page): Frame {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

/**
 * Commits a marker into the game state: `session.taps` through a bookmark and a restore.
 *
 * @param page - The test page.
 * @param taps - The marker.
 */
async function commitMarker(page: Page, taps: number): Promise<void> {
  await gameFrame(page).evaluate(async count => {
    const registry = (
      Reflect.get(globalThis, "editor") as {
        registry: { command(id: string): { run(input: object): Promise<{ value: unknown }> } };
      }
    ).registry;
    const { value } = await registry.command("game.bookmark").run({});
    const bookmark = value as { session: object };
    const changed = { ...bookmark, session: { ...bookmark.session, taps: count } };
    await registry.command("game.restore").run({ bookmark: changed });
  }, taps);
}

/** The facts of one element the game page answers in one evaluate. */
type Facts = Omit<Probe, "share">;

/**
 * Reads the rect of an element, the marker, the position and, for a texture, the element's
 * nine-slice in game.ui and whether a `NineSlice` of game.entities draws that texture.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @param texture - The texture looked for, "" for none.
 * @returns The facts, undefined while the page reloads.
 */
async function readFacts(page: Page, key: string, texture: string): Promise<Facts | undefined> {
  return gameFrame(page).evaluate(
    async ([uiKey, wanted]) => {
      type UiNode = { key?: string; style?: { nineSlice?: string }; children?: UiNode[] };
      type Entity = { components: { NineSlice?: { texture?: string } } };
      const editor = Reflect.get(globalThis, "editor") as
        | { registry: { source(id: string): { read(input: object): Promise<unknown> } } }
        | undefined;
      if (editor === undefined) return undefined;
      const read = (id: string, input: object = {}): Promise<unknown> =>
        editor.registry.source(id).read(input);
      const find = (node: UiNode): UiNode | undefined =>
        node.key === uiKey ? node : node.children?.map(child => find(child)).find(Boolean);

      const rect = (await read("game.rect", { key: uiKey })) as Rect | null;
      const model = (await read("game.model")) as { session: { taps: number } };
      const position = (await read("game.position")) as { path: string };
      if (wanted === "") {
        const facts = { taps: model.session.taps, path: position.path };
        return { ...facts, rect: rect ?? undefined, nineSlice: undefined, entityTexture: false };
      }
      const ui = (await read("game.ui")) as UiNode;
      const entities = (await read("game.entities")) as Entity[];
      return {
        rect: rect ?? undefined,
        taps: model.session.taps,
        path: position.path,
        nineSlice: find(ui)?.style?.nineSlice,
        entityTexture: entities.some(entity => entity.components.NineSlice?.texture === wanted)
      };
    },
    [key, texture] as const
  );
}

/**
 * The share of the pixels of a rect that have a colour (each channel within 50), in a frame the
 * game captures now (`game.capture`: a PNG data URL, or `{ png }`).
 *
 * @param page - The test page.
 * @param rect - The rect in game CSS px.
 * @param colour - The colour as RGB.
 * @returns The share, 0 to 1.
 */
async function colourShare(
  page: Page,
  rect: Rect,
  colour: readonly [number, number, number]
): Promise<number> {
  return gameFrame(page).evaluate(
    async ([box, rgb]) => {
      const editor = Reflect.get(globalThis, "editor") as {
        registry: { command(id: string): { run(input: object): Promise<{ value: unknown }> } };
      };
      const ran = await editor.registry.command("game.capture").run({});
      const shot = ran.value;
      const image = new Image();
      image.src = typeof shot === "string" ? shot : (shot as { png: string }).png;
      await image.decode();
      const ratio = image.width / innerWidth;
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      if (context === null) return 0;
      context.drawImage(image, 0, 0);
      const [x = 0, y = 0, w = 1, h = 1] = [box.x, box.y, box.w, box.h].map(value =>
        Math.max(1, Math.round(value * ratio))
      );
      const { data } = context.getImageData(x, y, w, h);
      let hits = 0;
      for (let index = 0; index < data.length; index += 4) {
        const close = [0, 1, 2].every(
          channel => Math.abs((data[index + channel] ?? 0) - (rgb[channel] ?? 0)) < 50
        );
        if (close) hits += 1;
      }
      return hits / (data.length / 4);
    },
    [rect, [...colour]] as const
  );
}

/**
 * Reads what the game page shows of one element: its rect, the marker, the position and, when
 * asked, its nine-slice or the share of its pixels that have a colour.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @param options - The texture or the colour to look for.
 * @returns The probe, undefined while the page reloads.
 */
async function probe(page: Page, key: string, options: ProbeOptions): Promise<Probe | undefined> {
  try {
    const facts = await readFacts(page, key, options.texture ?? "");
    if (facts === undefined) return undefined;
    const { rect } = facts;
    const share =
      options.colour === undefined || rect === undefined
        ? undefined
        : await colourShare(page, rect, options.colour);
    return { ...facts, share };
  } catch {
    return undefined;
  }
}

/**
 * One field of a probe without texture or colour.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @param field - The field.
 * @returns Its value, undefined while the page reloads.
 */
async function seen<K extends keyof Probe>(
  page: Page,
  key: string,
  field: K
): Promise<Probe[K] | undefined> {
  const result = await probe(page, key, {});
  return result?.[field];
}

// ---------------------------------------------------------------------------------------------
// The reference block
// ---------------------------------------------------------------------------------------------

/**
 * Four numbers of a `t/r/b/l` or `x,y w×h` text.
 *
 * @param text - The text.
 * @returns The numbers.
 */
function numbers(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
}

/**
 * Reads the block: its head, source, style, texture, layout and bounds lines.
 *
 * @param text - The clipboard text.
 * @returns The block.
 */
function parseBlock(text: string): Block {
  const line = (label: string): string =>
    text.split("\n").find(entry => entry.startsWith(`${label}: `)) ?? "";
  const head = /^@moku (\S+) · /.exec(text);
  const source = /source: (\S+):(\d+)/.exec(line("source"));
  const style = /style: (\S+) (\S+):(\d+)/.exec(line("source"));
  const texture = /texture: (\S+)/.exec(line("source"));
  const bounds = /^bounds: (.+) px · ref (.+)$/.exec(line("bounds"));
  if (head?.[1] === undefined || bounds?.[1] === undefined || bounds[2] === undefined) {
    throw new Error(`not a reference block:\n${text}`);
  }
  const [px0 = 0, px1 = 0, px2 = 0, px3 = 0] = numbers(bounds[1]);
  const [ref0 = 0, ref1 = 0, ref2 = 0, ref3 = 0] = numbers(bounds[2]);
  const layout = line("layout")
    .replace(/^layout: /, "")
    .split(" < ")
    .filter(entry => entry !== "")
    .map(entry => {
      const match = /^(\S+)(?: \((.*)\))?$/.exec(entry);
      const fields = new Map<string, number[]>();
      let direction: string | undefined;
      for (const field of (match?.[2] ?? "").split(", ").filter(Boolean)) {
        const [name = "", value] = field.split(" ");
        if (value === undefined) direction = name;
        else fields.set(name, numbers(value));
      }
      return { name: match?.[1] ?? entry, direction, fields };
    });
  return {
    text,
    name: head[1],
    source: source?.[1] === undefined ? undefined : { file: source[1], line: Number(source[2]) },
    style:
      style?.[1] === undefined || style[2] === undefined
        ? undefined
        : { name: style[1], file: style[2], line: Number(style[3]) },
    texture: texture?.[1],
    layout,
    px: { x: px0, y: px1, w: px2, h: px3 },
    ref: { x: ref0, y: ref1, w: ref2, h: ref3 }
  };
}

// ---------------------------------------------------------------------------------------------
// The code the block points to
// ---------------------------------------------------------------------------------------------

/**
 * Reads a file of the game copy.
 *
 * @param file - The path relative to the root.
 * @returns The text.
 */
async function readGame(file: string): Promise<string> {
  return readFile(path.join(GAME_ROOT, file), "utf8");
}

/**
 * The text between a `{` and the brace that closes it.
 *
 * @param text - The file text.
 * @param open - The index of the opening brace.
 * @returns The index just past the closing brace.
 */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("no closing brace");
}

/**
 * The object literal that starts at the first `{` after an index.
 *
 * @param text - The file text.
 * @param from - Where to look from.
 * @returns Its start and end.
 */
function objectAt(text: string, from: number): { start: number; end: number } {
  const start = text.indexOf("{", from);
  if (start === -1) throw new Error("no object literal");
  return { start, end: closingBrace(text, start) };
}

/**
 * The index of the start of a 1-based line.
 *
 * @param text - The file text.
 * @param line - The line.
 * @returns The index.
 */
function lineStart(text: string, line: number): number {
  let index = 0;
  for (let current = 1; current < line; current += 1) index = text.indexOf("\n", index) + 1;
  return index;
}

/**
 * Where a number of a style field sits in the code: the literal of the field, or the literal of
 * the `object.member` the field names, found in the same file.
 *
 * @param text - The file text.
 * @param scope - The object literal of the field.
 * @param scope.start - Its start.
 * @param scope.end - Its end.
 * @param field - A pattern of the field and its value expression in group 1.
 * @returns The index and the text of the literal.
 */
function literalOf(
  text: string,
  scope: { start: number; end: number },
  field: RegExp
): { index: number; value: string } {
  const body = text.slice(scope.start, scope.end);
  const match = field.exec(body);
  const expression = match?.[1]?.trim();
  if (match === null || expression === undefined) throw new Error(`no ${field} in the style`);
  const at = scope.start + match.index + match[0].lastIndexOf(expression);
  if (/^\d+(\.\d+)?$/.test(expression)) return { index: at, value: expression };

  const member = /^(\w+)\.(\w+)$/.exec(expression);
  if (member === null) throw new Error(`cannot follow ${expression}`);
  const declared = text.search(new RegExp(String.raw`const ${member[1]}\b[^=]*=\s*\{`));
  const object = objectAt(text, declared);
  const inner = new RegExp(String.raw`\b${member[2]}:\s*(\d+(?:\.\d+)?)`).exec(
    text.slice(object.start, object.end)
  );
  if (inner?.[1] === undefined) throw new Error(`no ${expression} literal`);
  return { index: object.start + inner.index + inner[0].lastIndexOf(inner[1]), value: inner[1] };
}

/**
 * Replaces a span of text.
 *
 * @param text - The text.
 * @param index - The start.
 * @param length - The length replaced.
 * @param value - The new text.
 * @returns The changed text.
 */
function splice(text: string, index: number, length: number, value: string): string {
  return `${text.slice(0, index)}${value}${text.slice(index + length)}`;
}

/**
 * The file a named import of a file comes from.
 *
 * @param file - The importing file, relative to the root.
 * @param text - Its text.
 * @param name - The imported name.
 * @returns The imported file, relative to the root.
 */
function importedFrom(file: string, text: string, name: string): string {
  for (const match of text.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
  )) {
    // `a as b` imports b: the last word of each entry.
    const names = (match[1] ?? "").split(",").map(entry => entry.trim().split(" ").at(-1));
    if (names.includes(name))
      return `${path.posix.join(path.posix.dirname(file), match[2] ?? "")}.ts`;
  }
  throw new Error(`${name} is not imported in ${file}`);
}

/**
 * The style block `export const <name> = defineStyle({…})` of a file.
 *
 * @param text - The file text.
 * @param from - An index at or before the declaration.
 * @returns The object literal of the style.
 */
function styleObject(text: string, from: number): { start: number; end: number } {
  const call = text.indexOf("defineStyle(", from);
  if (call === -1) throw new Error("no defineStyle");
  return objectAt(text, call);
}

/**
 * Every source file of the game copy (not node_modules, .moku or the e2e page).
 *
 * @param dir - A folder relative to the root.
 * @returns The `.ts` and `.tsx` files.
 */
async function sourceFiles(dir = ""): Promise<string[]> {
  const entries = await readdir(path.join(GAME_ROOT, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!["node_modules", ".moku", "web", "generated"].includes(entry.name)) {
        files.push(...(await sourceFiles(rel)));
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

/**
 * The text style a label's source line names (`style="ui.sign"`), and where its entry is in the
 * file that defines the text styles.
 *
 * @param block - The label's block.
 * @returns The file, its text, the entry and the style key.
 */
async function textStyleOf(
  block: Block
): Promise<{ file: string; text: string; entry: { start: number; end: number }; key: string }> {
  if (block.source === undefined) throw new Error("the block has no source line");
  const code = await readGame(block.source.file);
  const source = code.split("\n")[block.source.line - 1] ?? "";
  const key = /style="([^"]+)"/.exec(source)?.[1];
  if (key === undefined)
    throw new Error(`no text style on ${block.source.file}:${block.source.line}`);
  for (const file of await sourceFiles()) {
    const text = await readGame(file);
    if (!text.includes("defineTextStyles(")) continue;
    const at = text.indexOf(`"${key}": {`);
    if (at !== -1) return { file, text, entry: objectAt(text, at), key };
  }
  throw new Error(`no text style ${key}`);
}

/**
 * A texture of the same bundle and family (`ui.button-*`) with nine-slice insets, other than the
 * current one, from the game's asset manifest.
 *
 * @param current - The texture of the block.
 * @returns The texture key.
 */
async function siblingTexture(current: string): Promise<string> {
  const manifest = JSON.parse(await readGame("manifest.json")) as {
    bundles: Record<string, { files: { key: string; nine?: object }[] }>;
  };
  const family = current.slice(0, current.lastIndexOf("-") + 1);
  const keys = Object.values(manifest.bundles)
    .flatMap(bundle => bundle.files)
    .filter(file => file.nine !== undefined && file.key.startsWith(family) && file.key !== current)
    .map(file => file.key)
    .toSorted();
  const [first] = keys;
  if (first === undefined) throw new Error(`no texture beside ${current}`);
  return first;
}

/**
 * True when two numbers are within a tolerance.
 *
 * @param actual - The measured number.
 * @param expected - The expected number.
 * @param tolerance - The largest difference.
 * @returns Whether they are close.
 */
function near(actual: number | undefined, expected: number, tolerance: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) <= tolerance;
}

// ---------------------------------------------------------------------------------------------
// The five edits
// ---------------------------------------------------------------------------------------------

/** The five scripted edits, in order. */
const SCRIPTS: readonly Script[] = [
  {
    title: "move homeCoins 20 px",
    key: "homeCoins",
    derive: async (block, before) => {
      // The parent row of the layout line places it: its left padding moves it.
      const [parent] = block.layout;
      const padding = parent?.fields.get("padding");
      if (parent === undefined || padding === undefined || block.source === undefined) {
        throw new Error(`no parent padding in the layout line:\n${block.text}`);
      }
      const delta = Math.round((20 * block.ref.w) / block.px.w);
      const view = await readGame(block.source.file);
      const element = new RegExp(String.raw`key="${parent.name}"[^>]*style=\{(\w+)\}`).exec(view);
      if (element?.[1] === undefined) throw new Error(`no style of ${parent.name}`);
      const file = importedFrom(block.source.file, view, element[1]);
      const text = await readGame(file);
      const scope = styleObject(text, text.indexOf(`export const ${element[1]} =`));
      const padObject = objectAt(text, scope.start + text.slice(scope.start).indexOf("padding:"));
      const left = literalOf(text, padObject, /\bleft:\s*([^,}\n]+)/);
      expect(Number(left.value), "the code holds the block's left padding").toBe(padding[3]);
      const scale = (before.rect?.w ?? 0) / block.ref.w;
      const x = (before.rect?.x ?? 0) + delta * scale;
      return {
        file,
        next: splice(text, left.index, left.value.length, String(Number(left.value) + delta)),
        what: `${file}: ${parent.name} padding left ${left.value} → ${Number(left.value) + delta}`,
        options: {},
        shows: probe =>
          near(probe.rect?.x, x, 1) && near(probe.rect?.x, (before.rect?.x ?? 0) + 20, 1.5)
      };
    }
  },
  {
    title: "resize the Play button",
    key: "play",
    derive: async (block, before) => {
      if (block.style === undefined) throw new Error(`no style line:\n${block.text}`);
      const { file, line } = block.style;
      const text = await readGame(file);
      const scope = styleObject(text, lineStart(text, line));
      const width = Math.round(block.ref.w * 1.1);
      const height = Math.round(block.ref.h * 1.1);
      const widthField = /\bwidth:\s*([^,\n]+)/.exec(text.slice(scope.start, scope.end));
      const heightField = /\bheight:\s*([^,\n]+)/.exec(text.slice(scope.start, scope.end));
      if (widthField?.[1] === undefined || heightField?.[1] === undefined) {
        throw new Error("no width or height in the style");
      }
      // Height first: it comes after width, so the width index stays right.
      let next = splice(
        text,
        scope.start + heightField.index + heightField[0].lastIndexOf(heightField[1]),
        heightField[1].length,
        String(height)
      );
      next = splice(
        next,
        scope.start + widthField.index + widthField[0].lastIndexOf(widthField[1]),
        widthField[1].length,
        String(width)
      );
      const w = ((before.rect?.w ?? 0) * width) / block.ref.w;
      const h = ((before.rect?.h ?? 0) * height) / block.ref.h;
      return {
        file,
        next,
        what: `${file}:${line} ${block.style.name} ${block.ref.w}×${block.ref.h} → ${width}×${height}`,
        options: {},
        shows: probe => near(probe.rect?.w, w, 1) && near(probe.rect?.h, h, 1)
      };
    }
  },
  {
    title: "recolour a text style",
    key: "playLabel",
    derive: async (block, before) => {
      const { file, text, entry, key } = await textStyleOf(block);
      const fill = /\bfill:\s*([^,\n]+)/.exec(text.slice(entry.start, entry.end));
      if (fill?.[1] === undefined) throw new Error(`no fill in ${key}`);
      const colour = `0x${NEW_FILL.map(part => part.toString(16).padStart(2, "0")).join("_")}`;
      // Before the save the label has none of the new colour.
      expect(before.share ?? 1, "the new colour is not on the label yet").toBeLessThan(0.005);
      return {
        file,
        next: splice(
          text,
          entry.start + fill.index + fill[0].lastIndexOf(fill[1]),
          fill[1].length,
          colour
        ),
        what: `${file}: ${key} fill ${fill[1]} → ${colour}`,
        options: { colour: NEW_FILL },
        shows: probe => (probe.share ?? 0) > 0.03
      };
    }
  },
  {
    title: "change a text style size",
    key: "playLabel",
    derive: async (block, before) => {
      const { file, text, entry, key } = await textStyleOf(block);
      const size = /\bsize:\s*(\d+)/.exec(text.slice(entry.start, entry.end));
      if (size?.[1] === undefined) throw new Error(`no size in ${key}`);
      const from = Number(size[1]);
      const to = from + 20;
      const ratio = to / from;
      const w = (before.rect?.w ?? 0) * ratio;
      const h = (before.rect?.h ?? 0) * ratio;
      return {
        file,
        next: splice(
          text,
          entry.start + size.index + size[0].lastIndexOf(size[1]),
          size[1].length,
          String(to)
        ),
        what: `${file}: ${key} size ${from} → ${to}`,
        options: {},
        shows: probe => near(probe.rect?.w, w, w * 0.04) && near(probe.rect?.h, h, h * 0.04)
      };
    }
  },
  {
    title: "swap a texture",
    key: "play",
    derive: async block => {
      if (block.style === undefined || block.texture === undefined) {
        throw new Error(`no style or texture:\n${block.text}`);
      }
      const { file, line } = block.style;
      const text = await readGame(file);
      const scope = styleObject(text, lineStart(text, line));
      const quoted = `"${block.texture}"`;
      const at = text.slice(scope.start, scope.end).indexOf(quoted);
      if (at === -1) throw new Error(`${block.texture} is not in the style block`);
      const texture = await siblingTexture(block.texture);
      return {
        file,
        next: splice(text, scope.start + at, quoted.length, `"${texture}"`),
        what: `${file}:${line} nineSlice ${block.texture} → ${texture}`,
        options: { texture },
        shows: probe => probe.nineSlice === texture && probe.entityTexture
      };
    }
  }
];

// ---------------------------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------------------------

/**
 * Picks an element through its Reference mode proxy and reads the block off the clipboard.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The block text.
 */
async function pickBlock(page: Page, key: string): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const proxy = page.locator(`[data-moku-proxy][data-moku-key="${key}"]`);
  await expect(proxy).toHaveCount(1, { timeout: 15_000 });
  // A click on a proxy is its pointerup.
  await proxy.dispatchEvent("pointerup");
  let text = "";
  await expect
    .poll(
      async () => {
        text = await page.evaluate(() => navigator.clipboard.readText());
        return text.startsWith(`@moku ${key} · `) && text.includes("\nshot: ");
      },
      { timeout: 15_000 }
    )
    .toBe(true);
  return text;
}

/**
 * Polls the game page as fast as it answers until it shows the edit with the marker restored.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @param edit - The edit.
 * @param marker - The marker taps.
 * @param start - performance.now() at the save.
 * @returns The ms from the save, undefined when it never showed.
 */
async function timeToFrame(
  page: Page,
  key: string,
  edit: Edit,
  marker: number,
  start: number
): Promise<number | undefined> {
  while (performance.now() - start < GIVE_UP_MS) {
    const seen = await probe(page, key, edit.options);
    const restored = seen?.taps === marker && seen.path === "home";
    if (seen !== undefined && restored && edit.shows(seen)) return performance.now() - start;
  }
  return undefined;
}

/**
 * Formats the result table.
 *
 * @param rows - The rows.
 * @returns The Markdown table.
 */
function table(rows: readonly Row[]): string {
  const lines = rows.map(
    (row, index) =>
      `| ${index + 1} | ${row.edit} | ${row.firstTry ? "yes" : "no"} | ${row.ms === undefined ? "–" : Math.round(row.ms)} | ${row.change} |`
  );
  return [
    "| # | Edit | First try | Save → frame ms | Change |",
    "|---|---|---|---|---|",
    ...lines
  ].join("\n");
}

test.describe("edit loop (R7)", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.name !== "chromium-desktop",
      "the loop does not depend on the window: once, on desktop"
    );
  });

  test("five edits derived from the reference block show in the game with its state restored, each under 1500 ms", async ({
    tools,
    errors
  }, testInfo) => {
    test.setTimeout(240_000);
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await tools.show("game");
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-docked", "stage");
    await expect.poll(() => seen(page, "play", "path")).toBe("home");
    const initial = await probe(page, "play", {});
    // Reference mode: the proxies take the picks, the game gets no input.
    await page.keyboard.press("r");
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");

    const originals = new Map<string, string>();
    const rows: Row[] = [];
    try {
      for (const [index, script] of SCRIPTS.entries()) {
        const marker = 4100 + index;
        await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
          timeout: 30_000
        });
        await expect.poll(() => seen(page, script.key, "rect")).toBeDefined();
        await commitMarker(page, marker);
        await expect.poll(() => seen(page, script.key, "taps")).toBe(marker);

        const block = parseBlock(await pickBlock(page, script.key));
        const colour = script.title.startsWith("recolour") ? { colour: NEW_FILL } : {};
        const before = await probe(page, script.key, colour);
        if (before === undefined) throw new Error("the game did not answer");
        const edit = await script.derive(block, before);
        if (!originals.has(edit.file)) originals.set(edit.file, await readGame(edit.file));

        const start = performance.now();
        await writeFile(path.join(GAME_ROOT, edit.file), edit.next);
        const ms = await timeToFrame(page, script.key, edit, marker, start);
        rows.push({ edit: script.title, change: edit.what, firstTry: ms !== undefined, ms });
      }
    } finally {
      for (const [file, text] of originals) await writeFile(path.join(GAME_ROOT, file), text);
      // Each pick saved its crop and frame.
      await rm(path.join(GAME_ROOT, ".moku/captures"), { recursive: true, force: true });
      const report = table(rows);
      console.log(`\nEdit loop (save → frame with state restored):\n${report}\n`);
      await testInfo.attach("edit-loop.md", { body: report, contentType: "text/markdown" });
      // Kept next to the run's other output, for the report.
      await mkdir(testInfo.outputDir, { recursive: true });
      await writeFile(testInfo.outputPath("edit-loop.md"), `${report}\n`);
      await testInfo.attach("edit-loop.json", {
        body: JSON.stringify(rows, undefined, 2),
        contentType: "application/json"
      });
      // The page reloads once more with the files written back: wait for the first look.
      if (originals.size > 0 && initial?.rect !== undefined) {
        const back = initial.rect;
        await expect
          .poll(
            async () => {
              const rect = await seen(page, "play", "rect");
              return rect?.w;
            },
            { timeout: 20_000 }
          )
          .toBeCloseTo(back.w, 0)
          .catch(() => undefined);
      }
    }

    expect(rows.map(row => row.edit)).toEqual(SCRIPTS.map(script => script.title));
    for (const row of rows) {
      expect(row.firstTry, `${row.edit}: first try\n${table(rows)}`).toBe(true);
      expect(
        row.ms ?? Number.POSITIVE_INFINITY,
        `${row.edit}: save → frame\n${table(rows)}`
      ).toBeLessThanOrEqual(LIMIT_MS);
    }
  });
});
