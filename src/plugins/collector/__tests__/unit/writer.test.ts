import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WriterIo } from "../../session/writer";
import { enqueue, QUEUE_MAX_BYTES, writeLines } from "../../session/writer";
import { createLogSession } from "../../state";
import type { LogSession } from "../../types";
import type { TestCtx } from "../helpers";
import {
  createCtx,
  deviceOf,
  fileLines,
  headerLine,
  LOG,
  removeDir,
  sampleLine,
  spikeLine,
  tempDir
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The per-log writer: rx on every device line, arrival order across slow
// writes, a gap line and lost counts, one warning per failing streak.
// ─────────────────────────────────────────────────────────────────────────────

/** The computer epoch ms of the test batches. */
const RX = 1_791_986_090_000;

let root: string;
let ctx: TestCtx;
let session: LogSession;

/**
 * A fake io whose appends go through `append`.
 *
 * @param append - What one append does.
 * @returns The io and the texts it was asked to append.
 */
function fakeIo(append: (text: string, call: number) => Promise<void>) {
  const texts: string[] = [];
  const close = vi.fn(async () => undefined);
  const io: WriterIo = {
    mkdir: async () => undefined,
    open: async () => ({
      appendFile: (text: string) => {
        texts.push(text);
        return append(text, texts.length);
      },
      close
    })
  };
  return { io, texts, close };
}

/**
 * A batch of one sample line.
 *
 * @param t - Its page t.
 * @returns The batch.
 */
function batchOf(t: number) {
  return { log: LOG, from: 0, rx: RX, items: [sampleLine(t)], gap: 0, rejected: 0 };
}

beforeEach(async () => {
  root = await tempDir();
  ctx = createCtx(root);
  session = createLogSession({
    device: deviceOf(),
    log: LOG,
    file: join(root, "perf", "a.jsonl"),
    model: "SM-A266B"
  });
  ctx.state.sessions.set(session.key, session);
});

afterEach(async () => {
  await removeDir(root);
});

describe("writeLines", () => {
  it("stamps every device line with rx, creates the folder and appends to the file", async () => {
    const items = [headerLine(100), sampleLine(1100), spikeLine(1200, ["js"])];

    await writeLines(ctx, session, { log: LOG, from: 0, rx: RX, items, gap: 0, rejected: 0 });

    const lines = await fileLines(session.file);
    expect(lines.map(line => [line.kind, line.t, line.rx])).toEqual([
      ["header", 100, RX],
      ["sample", 1100, RX],
      ["spike", 1200, RX]
    ]);
    expect(lines[1]).toMatchObject({ path: "garden/boss", windowMs: 1000 });
    expect(session.lines).toBe(3);
    expect(session.offset).toBe(1200 - RX);
  });

  it("writes two batches in arrival order even when the first append is slow (bug: async hooks reordering appends)", async () => {
    const { promise: slow, resolve: release } = Promise.withResolvers<void>();
    const { io, texts } = fakeIo((_text, call) => (call === 1 ? slow : Promise.resolve()));

    const first = writeLines(ctx, session, batchOf(1000), io);
    const second = writeLines(ctx, session, batchOf(2000), io);
    release();
    await Promise.all([first, second]);

    expect(texts.map(text => JSON.parse(text).t)).toEqual([1000, 2000]);
    expect(session.lines).toBe(2);
  });

  it("counts a failed write as lost and warns once per failing streak (bug: drops never reported)", async () => {
    const { io } = fakeIo((_text, call) =>
      call === 3 ? Promise.resolve() : Promise.reject(new Error("ENOSPC"))
    );

    for (const t of [1000, 2000, 3000, 4000]) await writeLines(ctx, session, batchOf(t), io);

    expect(session.lost).toBe(3);
    expect(session.lines).toBe(1);
    expect(session.failing).toBe(true);
    expect(ctx.log.warn).toHaveBeenCalledTimes(2);
    expect(ctx.log.warn).toHaveBeenCalledWith("collector:write-failed", {
      file: session.file,
      lines: 1,
      error: "Error: ENOSPC"
    });
  });

  it("writes one gap line before the batch and counts the gap and the rejected lines as lost", async () => {
    await writeLines(ctx, session, {
      log: LOG,
      from: 12,
      rx: RX,
      items: [sampleLine(5000)],
      gap: 3,
      rejected: 1
    });

    const lines = await fileLines(session.file);
    expect(lines[0]).toEqual({
      v: 1,
      kind: "gap",
      t: 5000,
      build: "debug-pair",
      rx: RX,
      device: "SM-A266B",
      lines: 3
    });
    expect(lines.map(line => line.kind)).toEqual(["gap", "sample"]);
    expect(session.lost).toBe(4);
    expect(session.lines).toBe(2);
  });

  it("puts a gap without items on the page clock of the log", async () => {
    session.offset = 5917.4 - (RX - 10_000);

    await writeLines(ctx, session, { log: LOG, from: 9, rx: RX, items: [], gap: 2, rejected: 0 });

    const [gap] = await fileLines(session.file);
    expect(gap).toMatchObject({
      kind: "gap",
      t: 15_917.4,
      lines: 2
    });
  });
});

describe("queue bound and lost-only batches", () => {
  it("drops a write once 8 MiB wait in a log's queue, counts it lost and warns once per streak (bug: a stuck disk filling memory)", async () => {
    const { promise: stuck, resolve: release } = Promise.withResolvers<void>();
    const { io, texts } = fakeIo((_text, call) => (call === 1 ? stuck : Promise.resolve()));
    const half = `${"x".repeat(QUEUE_MAX_BYTES / 2)}\n`;

    const writes = [half, half, half, "y\n"].map(text => enqueue(ctx, session, text, 1, io));
    release();
    await Promise.all(writes);

    expect(texts).toEqual([half, "y\n"]);
    expect(session.lost).toBe(2);
    expect(session.lines).toBe(2);
    expect(ctx.log.warn.mock.calls).toEqual([
      ["collector:queue-full", { file: session.file, bytes: QUEUE_MAX_BYTES }]
    ]);
  });

  it("emits when a batch only changed the lost count", async () => {
    await writeLines(ctx, session, { log: LOG, from: 0, rx: RX, items: [], gap: 0, rejected: 3 });

    expect(session.lost).toBe(3);
    expect(ctx.emit).toHaveBeenCalledWith(
      "collector:session",
      expect.objectContaining({ lost: 3, lines: 0 })
    );
  });
});
