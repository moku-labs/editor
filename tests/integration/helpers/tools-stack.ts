/**
 * @file The tools stack of the root integration wave (plan §2.5): the tools page booted from the
 * HTML the real pages route serves, the tools core from `src/tools.ts` with the speed configs, a
 * tools probe that records all eleven tools events, and the workspace mounted inside `act`.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import { act } from "preact/test-utils";
import type { ToolsEvents } from "../../../src/config";
import type { ToolsBoot } from "../../../src/index";
import { createApp, createPlugin } from "../../../src/tools";
import { currentPage } from "./page";
import type { ServerStack } from "./server-stack";

/** The tools app type. */
export type ToolsApp = ReturnType<typeof createApp>;

/** The pluginConfigs a tools stack takes, merged per plugin over the speed configs. */
export type ToolsConfigs = NonNullable<
  NonNullable<Parameters<typeof createApp>[0]>["pluginConfigs"]
>;

/** One tools event as the probe recorded it. */
export type ToolsEvent = {
  [Name in keyof ToolsEvents]: { readonly name: Name; readonly payload: ToolsEvents[Name] };
}[keyof ToolsEvents];

/** One tools event of a known name. */
type EventOf<Name extends keyof ToolsEvents> = {
  readonly name: Name;
  readonly payload: ToolsEvents[Name];
};

/** Options of `bootTools`. */
export type ToolsOptions = {
  /** Extra plugins after the probe (e.g. P1's `probePanel`). */
  readonly plugins?: readonly AnyPluginInstance[];
  /** Extra pluginConfigs, merged per plugin over the speed configs. */
  readonly configs?: ToolsConfigs;
  /** Changes the served boot before it goes into the page (E1); `undefined` puts no boot tag (E2). */
  readonly boot?: (boot: ToolsBoot) => ToolsBoot | undefined;
  /** Mount the workspace after start. Default true; false for L3. */
  readonly mount?: boolean;
};

/** One running tools app. */
export type ToolsStack = {
  readonly kind: "tools";
  readonly app: ToolsApp;
  /** All eleven tools events, in order. */
  readonly events: ToolsEvent[];
  /** The payloads of one tools event, in order. */
  eventsOf<Name extends keyof ToolsEvents>(name: Name): ToolsEvents[Name][];
  /** Emits a tools event, standing in for an emitter that needs layout (I4). */
  emit<Name extends keyof ToolsEvents>(name: Name, payload: ToolsEvents[Name]): void;
  /** Mounts the workspace into the page root inside `act` (when `mount: false` was given). */
  mount(): Promise<void>;
  /** Stops the tools app. */
  stop(): Promise<void>;
};

/** The id of the boot tag pages injects. */
const BOOT_ID = "moku-editor-boot";

/** The boot tag in a served page. */
const BOOT_TAG = /<script type="application\/json" id="moku-editor-boot">([\s\S]*?)<\/script>/;

/**
 * The tools probe: a real tools plugin that records every tools event in order.
 *
 * @param events - Where the events go.
 * @returns The plugin.
 */
function createToolsProbe(events: ToolsEvent[]) {
  return createPlugin("toolsProbe", {
    hooks: () => ({
      "link:status": (payload: ToolsEvents["link:status"]) => {
        events.push({ name: "link:status", payload });
      },
      "workspace:changed": (payload: ToolsEvents["workspace:changed"]) => {
        events.push({ name: "workspace:changed", payload });
      },
      "workspace:ran": (payload: ToolsEvents["workspace:ran"]) => {
        events.push({ name: "workspace:ran", payload });
      },
      "workspace:density": (payload: ToolsEvents["workspace:density"]) => {
        events.push({ name: "workspace:density", payload });
      },
      "workspace:reference": (payload: ToolsEvents["workspace:reference"]) => {
        events.push({ name: "workspace:reference", payload });
      },
      "workspace:open-file": (payload: ToolsEvents["workspace:open-file"]) => {
        events.push({ name: "workspace:open-file", payload });
      },
      "workspace:select-node": (payload: ToolsEvents["workspace:select-node"]) => {
        events.push({ name: "workspace:select-node", payload });
      },
      "workspace:focus-frame": (payload: ToolsEvents["workspace:focus-frame"]) => {
        events.push({ name: "workspace:focus-frame", payload });
      },
      "workspace:reveal": (payload: ToolsEvents["workspace:reveal"]) => {
        events.push({ name: "workspace:reveal", payload });
      },
      "workspace:inspect": (payload: ToolsEvents["workspace:inspect"]) => {
        events.push({ name: "workspace:inspect", payload });
      },
      "workspace:open-sheet": (payload: ToolsEvents["workspace:open-sheet"]) => {
        events.push({ name: "workspace:open-sheet", payload });
      }
    })
  });
}

/**
 * The payloads of one tools event, in order.
 *
 * @param events - The recorded events.
 * @param name - The event name.
 * @returns The payloads.
 */
function payloadsOf<Name extends keyof ToolsEvents>(
  events: readonly ToolsEvent[],
  name: Name
): ToolsEvents[Name][] {
  const payloads: ToolsEvents[Name][] = [];
  for (const event of events) {
    if (isEvent(event, name)) payloads.push(event.payload);
  }
  return payloads;
}

/**
 * True when a recorded event has the name.
 *
 * @param event - A recorded event.
 * @param name - The event name.
 * @returns Whether it is that event.
 */
function isEvent<Name extends keyof ToolsEvents>(
  event: ToolsEvent,
  name: Name
): event is ToolsEvent & EventOf<Name> {
  return event.name === name;
}

/**
 * Fetches the tools page from the real pages route and reads its boot JSON.
 *
 * @param server - The running server.
 * @returns The boot the page carries.
 * @throws {Error} When the page does not answer 200 or carries no boot tag.
 */
async function servedBoot(server: ServerStack): Promise<ToolsBoot> {
  const response = await fetch(`${server.origin}${server.app.hub.path()}/`);
  const html = await response.text();
  const json = BOOT_TAG.exec(html)?.[1];
  if (!response.ok || json === undefined) {
    throw new Error(`the tools page answered ${String(response.status)} without a boot tag`);
  }
  const boot: ToolsBoot = JSON.parse(json);
  return boot;
}

/**
 * Puts the boot tag into the page body, replacing an earlier one; no tag for `undefined`.
 *
 * @param boot - The boot, or undefined.
 */
function putBoot(boot: ToolsBoot | undefined): void {
  globalThis.document.querySelector(`#${BOOT_ID}`)?.remove();
  if (boot === undefined) return;
  const tag = globalThis.document.createElement("script");
  tag.type = "application/json";
  tag.id = BOOT_ID;
  tag.textContent = JSON.stringify(boot);
  globalThis.document.body.append(tag);
}

/**
 * Boots the tools page: GET `<origin><hub path>/` from the real pages route, puts its boot JSON
 * into the page, creates the tools app with the speed configs (`link.retryMs: 100`,
 * `workspace.reloadTimeoutMs: 3000`, `flowView.layoutWorker: false`) and the tools probe, starts it
 * and mounts the workspace into `[data-editor-root]` inside `act`. Given a `ToolsBoot` instead of a
 * server (L4: nothing listens yet), it uses that boot as is.
 *
 * @param source - The running server, or a boot built by hand.
 * @param options - Extra plugins and configs, a boot change, mount on or off.
 * @returns The started tools stack.
 * @throws {Error} When no page is installed.
 */
export async function bootTools(
  source: ServerStack | ToolsBoot,
  options: ToolsOptions = {}
): Promise<ToolsStack> {
  const page = currentPage();
  if (page === undefined) throw new Error("bootTools needs installPage() first");
  const served = "v" in source ? source : await servedBoot(source);
  putBoot(options.boot === undefined ? served : options.boot(served));

  const events: ToolsEvent[] = [];
  const configs = options.configs ?? {};
  const app = createApp({
    plugins: [createToolsProbe(events), ...(options.plugins ?? [])],
    pluginConfigs: {
      ...configs,
      link: { retryMs: 100, ...configs.link },
      workspace: { reloadTimeoutMs: 3000, ...configs.workspace },
      flowView: { layoutWorker: false, ...configs.flowView }
    }
  });
  app.log.clearSinks();
  await app.start();

  const mount = async (): Promise<void> => {
    await act(() => {
      app.workspace.mount(page.root);
    });
  };
  if (options.mount !== false) await mount();

  return {
    kind: "tools",
    app,
    events,
    eventsOf: name => payloadsOf(events, name),
    emit: (name, payload) => {
      app.emit(name, payload);
    },
    mount,
    stop: () => app.stop()
  };
}
