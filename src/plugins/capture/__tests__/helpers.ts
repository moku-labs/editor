import { vi } from "vitest";
import type { Json, RunResult, RunState } from "../../registry/protocol";
import type { CommandEntry, SourceEntry } from "../../registry/types";
import { createCaptureState } from "../state";
import type {
  CaptureClock,
  CaptureDeps,
  CaptureRegistry,
  Config,
  DecodedPicture,
  EncodeOptions,
  PictureDecoder,
  PictureFormat
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the capture unit tests: a log mock, a fake registry whose
// game.capture answers what the test asks (and whose rect sources answer what
// the test gives), a fake clock and the domain deps.
// ─────────────────────────────────────────────────────────────────────────────

/** A PNG data URL as the door answers it. */
export const PNG = "data:image/png;base64,AAAA";

/** The envelope the fake registry answers for commands that run no door. */
export const ENVELOPE: RunState = { path: "board/awaitIntent", frame: 1790, tainted: false };

/** The default capture config. */
export const CONFIG: Config = { maxDurationMs: 20_000, minIntervalMs: 16 };

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

/** The mock log type. */
export type LogMock = ReturnType<typeof createLog>;

/** What the fake game.capture answers for one call: a value, or an error to throw. */
export type CaptureAnswer = { readonly value: Json } | { readonly error: Error };

/** A read of a fake source: raw input in, value out. */
export type SourceRead = ReturnType<typeof vi.fn<(raw: Json) => Json>>;

/** A fake registry slice with its game.capture door. */
export type FakeRegistry = CaptureRegistry & {
  /** The entries added with `add`, by id. */
  readonly added: Map<string, CommandEntry>;
  /** The game.capture entry (absent when the registry has none). */
  readonly capture: ReturnType<typeof vi.fn<(raw: Json) => Promise<RunResult>>>;
  /** The reads of the sources the test gave, by id. */
  readonly reads: Map<string, SourceRead>;
  /** The frame the next game.capture call reports. */
  frame: number;
};

/** Options of the fake registry. */
export type FakeRegistryOptions = {
  /** Whether the registry holds game.capture (default true). */
  readonly withCapture?: boolean;
  /** Runs before each answer (the test moves its clock here). */
  readonly onRun?: () => void;
  /** Sources the registry holds, by id: what each read answers. */
  readonly sources?: Readonly<Record<string, (raw: Json) => Json>>;
};

/**
 * The stop of a fake watch: does nothing.
 */
const unwatch = (): void => undefined;

/**
 * Builds a source entry around a read mock.
 *
 * @param id - The source id.
 * @param read - The read mock.
 * @returns The entry.
 */
function sourceEntry(id: string, read: SourceRead): SourceEntry {
  return {
    descriptor: { id, title: id, input: { key: "string?" }, changes: "frame" },
    read,
    watch: () => unwatch
  };
}

/**
 * Builds a fake registry whose game.capture answers `answer(call)`; the frame grows per call.
 *
 * @param answer - The answer of each call (0-based call index), a data URL by default.
 * @param options - `withCapture: false` leaves game.capture out; `sources` adds sources.
 * @returns The fake registry.
 */
export function fakeRegistry(
  answer: (call: number) => CaptureAnswer = () => ({ value: PNG }),
  options: FakeRegistryOptions = {}
): FakeRegistry {
  const added = new Map<string, CommandEntry>();
  const reads = new Map<string, SourceRead>(
    Object.entries(options.sources ?? {}).map(([id, read]) => [id, vi.fn(read)])
  );
  let calls = 0;
  const registry: FakeRegistry = {
    added,
    reads,
    frame: 1777,
    capture: vi.fn(async (_raw: Json): Promise<RunResult> => {
      const reply = answer(calls);
      calls += 1;
      options.onRun?.();
      registry.frame += 1;
      if ("error" in reply) throw reply.error;
      return { value: reply.value, state: { ...ENVELOPE, frame: registry.frame } };
    }),
    command: id => {
      if (id === "game.capture" && options.withCapture !== false) {
        return {
          descriptor: { id, title: "Capture", input: {}, effect: "read" },
          run: raw => registry.capture(raw)
        };
      }
      return added.get(id);
    },
    source: id => {
      const read = reads.get(id);
      return read === undefined ? undefined : sourceEntry(id, read);
    },
    add: entry => {
      added.set(entry.descriptor.id, entry);
    },
    envelope: () => ENVELOPE
  };
  return registry;
}

/** A clock the test moves by hand: `wait` jumps the time forward at once. */
export type FakeClock = CaptureClock & { time: number };

/**
 * Builds a fake clock starting at 1000 ms.
 *
 * @returns The clock.
 */
export function fakeClock(): FakeClock {
  const clock: FakeClock = {
    time: 1000,
    now: () => clock.time,
    wait: vi.fn(async (ms: number) => {
      clock.time += ms;
    })
  };
  return clock;
}

/** A decoded picture whose encoding and freeing are mocks. */
export type FakePicture = DecodedPicture & {
  readonly encode: ReturnType<typeof vi.fn<(options: EncodeOptions) => Promise<string>>>;
  readonly close: ReturnType<typeof vi.fn<() => void>>;
};

/** A picture decoder that hands out one FakePicture per call and keeps them. */
export type FakeDecoder = ReturnType<typeof vi.fn<PictureDecoder>> & {
  /** The pictures decoded so far, in call order. */
  readonly pictures: FakePicture[];
};

/**
 * The data URL the fake picture encodes at a size in a format.
 *
 * @param format - The encoded format.
 * @param width - Encoded width in pixels.
 * @param height - Encoded height in pixels.
 * @returns A fake data URL naming the format and the size.
 */
export function encodedAs(format: PictureFormat, width: number, height: number): string {
  return `data:image/${format};base64,${String(width)}x${String(height)}`;
}

/**
 * The data URL the fake picture draws at a size as a PNG.
 *
 * @param width - Drawn width in pixels.
 * @param height - Drawn height in pixels.
 * @returns A fake PNG data URL naming the size.
 */
export function smallPng(width: number, height: number): string {
  return encodedAs("png", width, height);
}

/**
 * The data URL the fake picture draws at a size as a JPEG.
 *
 * @param width - Drawn width in pixels.
 * @param height - Drawn height in pixels.
 * @returns A fake JPEG data URL naming the size.
 */
export function smallJpeg(width: number, height: number): string {
  return encodedAs("jpeg", width, height);
}

/**
 * Builds a decoder whose pictures are `width` × `height` pixels and encode
 * `encodedAs(format, size.width, size.height)`.
 *
 * @param width - Picture width in pixels.
 * @param height - Picture height in pixels.
 * @returns The decoder.
 */
export function fakeDecoder(width = 1080, height = 1920): FakeDecoder {
  const pictures: FakePicture[] = [];
  const decode = vi.fn(async (_image: string): Promise<DecodedPicture> => {
    const picture: FakePicture = {
      width,
      height,
      encode: vi.fn(async (options: EncodeOptions) =>
        encodedAs(options.format, options.size.width, options.size.height)
      ),
      close: vi.fn()
    };
    pictures.push(picture);
    return picture;
  });
  return Object.assign(decode, { pictures });
}

/** Domain deps whose log and decoder are the mocks. */
export type TestDeps = CaptureDeps & { readonly log: LogMock; readonly decode: FakeDecoder };

/**
 * Builds domain deps with a real state, a mock log, a 1080 × 1920 fake decoder and the given clock.
 *
 * @param clock - The clock.
 * @param config - Config overrides.
 * @returns The deps.
 */
export function createDeps(clock: CaptureClock, config: Partial<Config> = {}): TestDeps {
  return {
    config: { ...CONFIG, ...config },
    state: createCaptureState(),
    log: createLog(),
    clock,
    decode: fakeDecoder()
  };
}

/**
 * Awaits a promise and returns what it rejected with.
 *
 * @param promise - The promise.
 * @returns The rejection reason.
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/**
 * Runs a function and returns what it threw.
 *
 * @param fn - The function.
 * @returns The thrown value.
 */
export function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}
