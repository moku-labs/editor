/**
 * @file The e2e test fixture. `tools` opens the tools page, waits for the link to go live with
 * the merge-game manifest and hands a small driver to the test. `errors` runs for every test: it
 * records console errors and warnings, uncaught exceptions, unhandled rejections and failed
 * responses on BOTH the tools page and the game frame, and fails the test on any entry the
 * allowlist does not name.
 */
import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * The six workspaces in rail order (⌘1-⌘6), with their labels. Game is first and the default.
 */
export const WORKSPACES = [
  { id: "game", label: "Game" },
  { id: "flow", label: "Flow" },
  { id: "render", label: "Render" },
  { id: "state", label: "State" },
  { id: "files", label: "Files" },
  { id: "console", label: "Console" }
] as const;

/** One workspace id. */
export type WorkspaceId = (typeof WORKSPACES)[number]["id"];

/** The game name the merge-game fixture registers (e2e/game/editor.ts). */
export const GAME_NAME = "merge-game 0.0.0";

/** The tools page path the bin serves. */
export const TOOLS_PATH = "/__editor/";

/**
 * Warnings of the game frame that are not defects of the editor: pixi probes WebGPU first and
 * logs that headless chromium has no adapter, and the GL driver reports the ReadPixels stall of
 * the capture plugin's frame read.
 */
const GAME_ALLOWED: readonly RegExp[] = [
  /^No available adapters\.$/,
  /GPU stall due to ReadPixels/
];

/** Where an entry came from. */
type Source = "tools" | "game";

/** One captured error. */
export type Captured = { readonly source: Source; readonly kind: string; readonly text: string };

/** The error log of one test. */
export type ErrorLog = {
  /** Every captured entry, allowed or not. */
  readonly all: Captured[];
  /** Allows entries whose text matches, for a test that provokes them on purpose. */
  allow(pattern: RegExp): void;
  /** The entries no allowlist names. */
  unexpected(): Captured[];
};

/**
 * The source of a URL: the tools page lives under /__editor/, the game page is everything else
 * the bin serves.
 *
 * @param url - A frame, script or request URL.
 * @returns The side it belongs to.
 */
function sourceOf(url: string): Source {
  return url.includes(TOOLS_PATH) ? "tools" : "game";
}

/**
 * Records `error` and `unhandledrejection` in every frame (the tools page and the game iframe),
 * as a console error the `console` listener then sees with the frame URL.
 */
const FRAME_GUARD = `(() => {
  addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    console.error("[e2e] unhandled rejection: " + (reason && reason.stack ? reason.stack : String(reason)));
  });
})();`;

/**
 * Starts recording the errors of a page and its frames.
 *
 * @param page - The test page.
 * @returns The log.
 */
async function recordErrors(page: Page): Promise<ErrorLog> {
  const all: Captured[] = [];
  const allowed: RegExp[] = [];
  await page.addInitScript(FRAME_GUARD);

  page.on("console", message => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    const frameUrl = message.location().url || page.url();
    all.push({ source: sourceOf(frameUrl), kind: `console.${type}`, text: message.text() });
  });
  page.on("pageerror", error => {
    all.push({ source: "tools", kind: "pageerror", text: error.stack ?? error.message });
  });
  page.on("response", response => {
    if (response.status() < 400) return;
    const url = response.url();
    all.push({ source: sourceOf(url), kind: `http ${response.status()}`, text: url });
  });
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText ?? "failed";
    // A navigation or reload cancels the requests of the page it leaves.
    if (reason === "net::ERR_ABORTED") return;
    all.push({
      source: sourceOf(request.url()),
      kind: "requestfailed",
      text: `${reason} ${request.url()}`
    });
  });

  const isAllowed = (entry: Captured): boolean =>
    allowed.some(pattern => pattern.test(entry.text)) ||
    (entry.source === "game" && GAME_ALLOWED.some(pattern => pattern.test(entry.text)));

  return {
    all,
    allow: pattern => {
      allowed.push(pattern);
    },
    unexpected: () => all.filter(entry => !isAllowed(entry))
  };
}

/**
 * Opens the tools page and waits for a live link with the merge-game manifest.
 *
 * @param page - The test page.
 * @param hash - An optional workspace hash, e.g. "#render".
 */
export async function openTools(page: Page, hash = ""): Promise<void> {
  // "load" waits for the game iframe, which never settles while the game streams frames.
  await page.goto(`${TOOLS_PATH}${hash}`, { waitUntil: "domcontentloaded" });
  await waitLive(page);
}

/**
 * Waits for a live link and the merge-game manifest in the top bar.
 *
 * @param page - The test page.
 */
export async function waitLive(page: Page): Promise<void> {
  await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
    timeout: 30_000
  });
  await expect(page.locator("[data-ui=top-bar] [data-game-name]")).toHaveText(GAME_NAME);
  await expect(page.locator("[data-ui=status-card]")).toBeHidden();
}

/** Resolves after two animation frames, so a layout pass has painted. */
const TWO_FRAMES =
  "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))";

/** The driver of the tools page a test gets. */
export type Tools = {
  readonly page: Page;
  /** The rail button of a workspace. */
  railButton(ws: WorkspaceId): Locator;
  /** The host section of a workspace. */
  host(ws: WorkspaceId): Locator;
  /** Shows a workspace with the rail and waits for its host. */
  show(ws: WorkspaceId): Promise<void>;
  /** The live, volatile regions a screenshot masks. */
  volatile(): Locator[];
  /** Waits for fonts and two frames, for a stable screenshot. */
  settle(): Promise<void>;
};

/**
 * Builds the driver.
 *
 * @param page - The test page.
 * @returns The driver.
 */
function driver(page: Page): Tools {
  const railButton = (ws: WorkspaceId): Locator =>
    page.locator(`[data-ui=rail] button[data-workspace=${ws}]`);
  const host = (ws: WorkspaceId): Locator => page.locator(`[data-workspace-host=${ws}]`);
  return {
    page,
    railButton,
    host,
    show: async ws => {
      await railButton(ws).click();
      await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", ws);
      await expect(host(ws)).toBeVisible();
    },
    volatile: () => [
      page.locator("[data-ui=link-pill]"),
      page.locator("[data-ui=session-chip]"),
      page.locator("[data-ui=preview] [data-preview-body]"),
      page.locator("[data-frame-box]"),
      page.locator("[data-render=workspace] > h1"),
      page.locator("[data-render=tiles]"),
      page.locator("[data-render=textures] tbody"),
      page.locator("[data-part=title]"),
      page.locator("[data-part=runner-card]"),
      page.locator("[data-part=session-card]"),
      page.locator("[data-frame-link]")
    ],
    settle: async () => {
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.evaluate(TWO_FRAMES);
    }
  };
}

/**
 * The e2e test: `errors` is automatic, `tools` opens a live tools page.
 */
export const test = base.extend<{ errors: ErrorLog; tools: Tools }>({
  errors: [
    async ({ page }, use, testInfo) => {
      const log = await recordErrors(page);
      await use(log);
      const unexpected = log.unexpected();
      if (log.all.length > 0) {
        await testInfo.attach("errors.json", {
          body: JSON.stringify(log.all, undefined, 2),
          contentType: "application/json"
        });
      }
      expect(unexpected, "errors on the tools page or in the game frame").toEqual([]);
    },
    { auto: true }
  ],
  tools: async ({ page, errors }, use) => {
    expect(errors.all).toEqual([]);
    await openTools(page);
    await use(driver(page));
  }
});

export { expect } from "@playwright/test";
