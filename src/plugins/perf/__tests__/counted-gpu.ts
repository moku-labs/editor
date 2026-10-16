import { onTestFinished } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A counted WebGPU stand-in for the real-engine harness (../real-engine.ts):
// the seven Pixi bases the engine swaps for its counting subclasses (so an agent
// build's monitor counts passes, draws, filter applies and render targets), an
// application whose renderer draws each frame through those subclasses, and the
// engine's own GPU device on `navigator.gpu` (no timestamp-query: no GPU timer).
// The engine's code writes the pass ring, the compile records and the counts;
// the stand-in only drives it the way Pixi 8 does.
// ─────────────────────────────────────────────────────────────────────────────

/** A render target as the engine's pass sink reads it: size, label and its color texture's source. */
export type StandInTarget = {
  readonly label: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly colorTexture: {
    readonly source: { readonly format: string; readonly resolution: number };
  };
};

/** A texture source as the engine's texture counting reads it: a render target has no upload method. */
type StandInSource = { readonly uploadMethodId: string };

/** A Pixi runner or signal the engine adds a listener to and removes it from; it never fires. */
const silentRunner = { add: (): void => undefined, remove: (): void => undefined };

/** The canvas target: the engine names a pass on it `canvas` (`renderer.view.renderTarget`). */
export const CANVAS_TARGET: StandInTarget = {
  label: "canvas",
  pixelWidth: 1080,
  pixelHeight: 2340,
  colorTexture: { source: { format: "bgra8unorm", resolution: 2 } }
};

/** The target the stand-in's filter draws into: a pooled texture of the filter system. */
export const FILTER_TARGET: StandInTarget = {
  label: "filter",
  pixelWidth: 540,
  pixelHeight: 1170,
  colorTexture: { source: { format: "rgba16float", resolution: 1 } }
};

/** The label of the render pipeline the stand-in's filter creates in its first apply. */
export const PIPELINE_LABEL = "PIXI Pipeline (stand-in-blur)";

/** Draws the stand-in issues in the canvas pass of each frame. */
export const CANVAS_DRAWS = 3;

/** Draws the stand-in issues in the filter pass of each frame. */
export const FILTER_DRAWS = 1;

/**
 * The filter the stand-in applies each frame. While no entity hangs it the engine names it
 * `"other"` with owner 0; hung through `renderer.sync.filters.set` (`startPair`'s `filterKind`) it
 * takes that entity and kind.
 */
export const STAND_IN_FILTER = { label: "stand-in-blur" };

/** The filter's input texture: the engine counts its pixels. */
const INPUT = { source: { resolution: 1 }, frame: { width: 540, height: 1170 } };

/** The pass Pixi begins: no depth-stencil attachment. */
const PASS = { descriptor: {} };

/** The Pixi extension metadata of a base; the counting subclass keeps it. */
type Extension = { readonly name: string };

/** Pixi's batcher pipe (the engine counts rebuilds on it). */
class StandInBatcherPipe {
  static readonly extension: Extension = { name: "batch" };
  /**
   * A render group's instruction list is rebuilt.
   *
   * @param _instructions - The instruction set.
   */
  buildStart(_instructions: object): void {}
}

/** Pixi's WebGPU batch adaptor (one draw per batch). */
class StandInGpuBatchAdaptor {
  static readonly extension: Extension = { name: "batch-adaptor" };
  /** Draws a batch. */
  execute(): void {}
}

/** Pixi's WebGPU graphics adaptor. */
class StandInGpuGraphicsAdaptor {
  static readonly extension: Extension = { name: "graphics-adaptor" };
  /** Draws a graphics object. */
  execute(): void {}
}

/** Pixi's WebGL texture system (uploads). */
class StandInGlTextureSystem {
  static readonly extension: Extension = { name: "gl-texture" };
  /**
   * Uploads a source.
   *
   * @param _source - The source.
   */
  onSourceUpdate(_source: StandInSource): void {}
}

/** Pixi's WebGPU encoder: passes and draws; the engine's subclass counts them. */
class StandInGpuEncoderSystem {
  static readonly extension: Extension = { name: "encoder" };
  /** The command encoder the engine's GPU timer resolves into (unused: no timer). */
  readonly commandEncoder = {};
  /**
   * Begins a render pass.
   *
   * @param _pass - The GPU render target with its descriptor.
   */
  beginRenderPass(_pass: typeof PASS): void {}
  /** Ends the running pass. */
  finishRenderPass(): void {}
  /** Issues a draw. */
  draw(): void {}
  /** Issues an indirect draw. */
  drawIndirect(): void {}
  /** Submits the frame. */
  postrender(): void {}
}

/** What the filter system draws through: the renderer's filter pass. */
type FilterHost = { drawFilterPass(): void };

/** Pixi's filter system; the engine's subclass names the passes begun inside an apply. */
class StandInFilterSystem {
  static readonly extension: Extension = { name: "filter" };
  /** The renderer it draws through. */
  private readonly host: FilterHost;
  /**
   * Keeps the renderer.
   *
   * @param host - The renderer.
   */
  constructor(host: FilterHost) {
    this.host = host;
  }
  /**
   * Applies a filter: one pass into its output.
   *
   * @param _filter - The filter.
   * @param _input - Its input texture.
   * @param _output - Where it draws.
   * @param _clear - Whether the output is cleared first.
   */
  applyFilter(
    _filter: typeof STAND_IN_FILTER,
    _input: typeof INPUT,
    _output: StandInTarget,
    _clear: boolean
  ): void {
    this.host.drawFilterPass();
  }
}

/** Pixi's WebGPU texture system; the engine's subclass counts render targets made and dropped. */
class StandInGpuTextureSystem {
  static readonly extension: Extension = { name: "gpu-texture" };
  /**
   * Makes the GPU texture of a source.
   *
   * @param _source - The source.
   * @returns The texture.
   */
  initSource(_source: StandInSource): object {
    return {};
  }
  /**
   * Uploads a source.
   *
   * @param _source - The source.
   */
  onSourceUpdate(_source: StandInSource): void {}
  /**
   * Drops a source's GPU texture.
   *
   * @param _source - The source.
   */
  onSourceUnload(_source: StandInSource): void {}
}

/** A class the extension registry holds. */
type ExtensionClass = abstract new (...args: never[]) => object;

/**
 * The class the registry holds in place of a base: the engine's counting subclass once installed,
 * the base otherwise.
 *
 * @param registry - The classes the engine added.
 * @param base - The base.
 * @returns The class to construct.
 */
function swapped<Base extends ExtensionClass>(
  registry: readonly ExtensionClass[],
  base: Base
): Base {
  const found = registry.find(added => added.prototype instanceof base);
  // boundary: the registry hands back the subclass the engine made of this very base
  return (found ?? base) as Base;
}

/** The engine's own GPU device: compiles are counted on it, `lost` never settles. */
export type StandInDevice = {
  readonly features: ReadonlySet<string>;
  readonly lost: Promise<never>;
  createRenderPipeline(descriptor: { readonly label?: string }): object;
  createShaderModule(descriptor: { readonly label?: string }): object;
  destroy(): void;
};

/**
 * The engine's own device of the stand-in: no `timestamp-query`, so no GPU timer.
 *
 * @returns The device.
 */
function createDevice(): StandInDevice {
  return {
    features: new Set<string>(),
    lost: new Promise<never>(() => undefined),
    createRenderPipeline: () => ({}),
    createShaderModule: () => ({}),
    destroy: () => undefined
  };
}

/** The `app.init` options of the engine that the stand-in reads: the engine's own device. */
type InitOptions = { readonly webgpu?: { readonly gpu?: { readonly device?: StandInDevice } } };

/**
 * A Pixi module whose application draws on a counted WebGPU renderer: each frame a canvas pass of
 * `CANVAS_DRAWS` draws, then a filter applied into `FILTER_TARGET` with `FILTER_DRAWS`, a render
 * target made and the previous one dropped (churn), and in the first apply a render pipeline
 * created on the engine's device (a compile during the filter pass).
 *
 * @returns The module.
 */
function createCountedPixi() {
  const registry: ExtensionClass[] = [];
  let lastTarget: StandInSource | undefined;
  let compiled = false;

  /** The renderer: its systems are the classes the registry holds when the application is made. */
  class StandInGpuRenderer {
    readonly name = "webgpu";
    readonly texture = { managedTextures: [] };
    readonly runners = {
      prerender: silentRunner,
      renderStart: silentRunner,
      postrender: silentRunner
    };
    readonly view = { renderTarget: CANVAS_TARGET };
    readonly renderTarget = {
      renderTarget: CANVAS_TARGET,
      onRenderTargetChange: silentRunner
    };
    readonly background = { clearBeforeRender: true };
    readonly gpu: { readonly device: StandInDevice };
    readonly encoder: StandInGpuEncoderSystem;
    readonly filter: StandInFilterSystem;
    readonly textures: StandInGpuTextureSystem;
    /**
     * Makes the renderer's systems from the extension registry.
     *
     * @param device - The device the engine handed Pixi.
     */
    constructor(device: StandInDevice) {
      this.gpu = { device };
      this.encoder = Reflect.construct(swapped(registry, StandInGpuEncoderSystem), [this]);
      this.filter = Reflect.construct(swapped(registry, StandInFilterSystem), [this]);
      this.textures = Reflect.construct(swapped(registry, StandInGpuTextureSystem), [this]);
    }
    /** Draws a frame: the canvas pass, then the filter. */
    render(): void {
      this.renderTarget.renderTarget = CANVAS_TARGET;
      this.encoder.beginRenderPass(PASS);
      for (let draw = 0; draw < CANVAS_DRAWS; draw += 1) this.encoder.draw();
      this.filter.applyFilter(STAND_IN_FILTER, INPUT, FILTER_TARGET, true);
      this.encoder.postrender();
    }
    /** The filter's pass, inside the filter system's apply: a new target, a pass, a compile once. */
    drawFilterPass(): void {
      const target: StandInSource = { uploadMethodId: "unknown" };
      this.textures.initSource(target);
      if (lastTarget !== undefined) this.textures.onSourceUnload(lastTarget);
      lastTarget = target;
      this.renderTarget.renderTarget = FILTER_TARGET;
      this.encoder.beginRenderPass(PASS);
      if (!compiled) {
        compiled = true;
        this.gpu.device.createRenderPipeline({ label: PIPELINE_LABEL });
      }
      for (let draw = 0; draw < FILTER_DRAWS; draw += 1) this.encoder.draw();
      this.renderTarget.renderTarget = CANVAS_TARGET;
    }
    /** Resizes the canvas. */
    resize(): void {}
  }

  /** The application: its renderer is made at `init`, with the engine's own device. */
  class StandInApplication {
    renderer: StandInGpuRenderer | undefined;
    canvas = document.createElement("canvas");
    /**
     * Makes the renderer with the device the engine requested.
     *
     * @param options - The engine's init options.
     */
    async init(options: InitOptions): Promise<void> {
      await Promise.resolve();
      this.renderer = new StandInGpuRenderer(options.webgpu?.gpu?.device ?? createDevice());
    }
    /** Removes the canvas. */
    destroy(): void {
      this.canvas.remove();
    }
  }

  return {
    Application: StandInApplication,
    BatcherPipe: StandInBatcherPipe,
    GpuBatchAdaptor: StandInGpuBatchAdaptor,
    GpuGraphicsAdaptor: StandInGpuGraphicsAdaptor,
    GpuEncoderSystem: StandInGpuEncoderSystem,
    FilterSystem: StandInFilterSystem,
    GpuTextureSystem: StandInGpuTextureSystem,
    GlTextureSystem: StandInGlTextureSystem,
    extensions: {
      add: (...classes: ExtensionClass[]): void => {
        registry.push(...classes);
      },
      remove: (...classes: ExtensionClass[]): void => {
        for (const removed of classes) {
          const at = registry.indexOf(removed);
          if (at !== -1) registry.splice(at, 1);
        }
      }
    }
  };
}

/**
 * Puts the engine's own GPU on `navigator.gpu` for the test (an adapter without timestamp-query and
 * its device), removed when the test finishes, and answers the Pixi module of a counted WebGPU
 * application.
 *
 * @returns The Pixi module `loadPixi` answers.
 */
export function countedGpuPixi() {
  const device = createDevice();
  const adapter = {
    features: new Set<string>(),
    limits: { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16 },
    info: { vendor: "stand-in", architecture: "counted" },
    requestDevice: async () => device
  };
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: { requestAdapter: async () => adapter }
  });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, "gpu");
  });
  return createCountedPixi();
}
