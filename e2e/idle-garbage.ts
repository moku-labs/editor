/**
 * @file The idle-garbage bench (F56): the editor bin with the e2e game, the tools page open on a
 * workspace, and Chromium's sampling heap profiler on the page for a window, garbage included.
 * It prints what the game page (engine, agent and game, one bundle) allocates per second, the
 * part of it inside the game's frames, and the top allocating stacks of each.
 *
 * Run it after `bun run build && bun e2e/prepare-game.ts`:
 *
 * ```sh
 * bun e2e/idle-garbage.ts 15 "#render"
 * ```
 */
import { chromium } from "@playwright/test";
import { startEditor } from "./editor-server";

/** What a profile frame is named by: the call frame of a sampling-profile node. */
type CallFrameOf = {
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
  };
};

/** The bin index of the bench: a port of its own, clear of the e2e workers. */
const BENCH_INDEX = 9;

/** How long the page settles before the window opens. */
const SETTLE_MS = 8000;

/** The bundle of the game page: the engine, the agent and the game in one file. */
const GAME_BUNDLE = "editor-";

/** The frames of the game loop: a stack through one of them was allocated inside a frame. */
const FRAME_FRAMES = /^(runFrame|runMeasuredFrame|runFrameWork) /;

/** Bytes in a MB. */
const MB = 2 ** 20;

/** How many stacks each table lists. */
const TOP = 25;

/**
 * Names a profile frame: function, file and line.
 *
 * @param node - The profile node.
 * @returns E.g. `toWireValue @ editor-1a2b.js:517`.
 */
function labelOf(node: CallFrameOf): string {
  const { functionName, url, lineNumber } = node.callFrame;
  const file = url.split("/").at(-1)?.split("?")[0] || "(native)";
  return `${functionName || "(anon)"} @ ${file}:${lineNumber + 1}`;
}

/**
 * Adds a size to a table row.
 *
 * @param table - The table.
 * @param key - The row.
 * @param size - Bytes.
 */
function add(table: Map<string, number>, key: string, size: number): void {
  table.set(key, (table.get(key) ?? 0) + size);
}

/**
 * The top rows of a table, in KB.
 *
 * @param table - The table.
 * @returns The printed rows.
 */
function topOf(table: Map<string, number>): string {
  return [...table]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([key, size]) => {
      const kb = `${Math.round(size / 1024)} KB`;
      return `${kb.padStart(9)} ${key}`;
    })
    .join("\n");
}

const seconds = Number(process.argv[2] ?? 15);
const hash = process.argv[3] ?? "";
const { server, stop } = await startEditor(BENCH_INDEX);
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${server.url}/__editor/${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(SETTLE_MS);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 1024,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true
  });
  await page.waitForTimeout(seconds * 1000);
  const { profile } = await cdp.send("HeapProfiler.stopSampling");

  const inFrame = new Map<string, number>();
  const outside = new Map<string, number>();
  let total = 0;
  let frameTotal = 0;

  /**
   * Walks the profile: a sample belongs to the game page when the nearest script frame above it
   * is in the game bundle.
   *
   * @param node - The node.
   * @param stack - The labels above it.
   * @param owner - The file of the nearest script frame above it.
   */
  const walk = (node: typeof profile.head, stack: readonly string[], owner: string): void => {
    const label = labelOf(node);
    const file = node.callFrame.url === "" ? owner : node.callFrame.url;
    const next = [...stack, label];
    if (node.selfSize > 0 && file.includes(GAME_BUNDLE)) {
      total += node.selfSize;
      const key = next.slice(-4).toReversed().join(" < ");
      if (next.some(frame => FRAME_FRAMES.test(frame))) {
        frameTotal += node.selfSize;
        add(inFrame, key, node.selfSize);
      } else {
        add(outside, key, node.selfSize);
      }
    }
    for (const child of node.children) walk(child, next, file);
  };
  walk(profile.head, [], "");

  const rate = (bytes: number): string => `${(bytes / MB / seconds).toFixed(3)} MB/s`;
  console.log(
    `game page ${rate(total)}: in frames ${rate(frameTotal)}, outside ${rate(total - frameTotal)}`
  );
  console.log(`\nOUTSIDE FRAMES\n${topOf(outside)}\n\nIN FRAMES\n${topOf(inFrame)}`);
} finally {
  await browser.close();
  await stop();
}
