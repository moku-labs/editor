/**
 * The e2e suite of the tools page. e2e/global-setup.ts builds the package (tsdown and the tools
 * page bundle) and copies the tiny game of e2e/game into dist-e2e/game once. Each worker then
 * serves its own copy with its own bin on its own port (e2e/editor-server.ts): the bin hosts one
 * game link, so workers never share one. The bin logs go to dist-e2e/server-<n>.log, which
 * e2e/global-teardown.ts scans for errors.
 *
 * The bin runs with its defaults, so Bun hot reload is on (D-23): a save of a game source reloads
 * the game page, and the bridge restores its checkpoint. e2e/top-bar.spec.ts flips the Hot reload
 * switch off and on (D-32: the bin restarts its server on the same port) and leaves it on.
 *
 * Window sizes: every spec runs on desktop (1440×900). Only the specs whose subject is the layout
 * at a width also run on the two half-screen windows (720×900, 960×1080) and the third-screen
 * window of the Claude pane (480×900): baseline, layout, half-screen and pane. The top-bar spec
 * sets its own window sizes and runs in the desktop project only. Phones are out of scope (no
 * mobile layout, D-21): the Pixel 7 project only runs the boot guard, e2e/no-js-errors.spec.ts.
 *
 * Every context may read and write the clipboard: a pick puts the reference block there (round 2
 * R2), and a browser without the grant refuses the write.
 */
import { defineConfig, devices } from "@playwright/test";

/** Workers, each with its own bin; `E2E_WORKERS=1` runs one at a time. */
const WORKERS = Number(process.env.E2E_WORKERS ?? 4);

/** The specs whose subject is the layout at a width: they also run on the narrow windows. */
const LAYOUT_SPECS = /(baseline|layout|half-screen|pane)\.spec\.ts$/;

const CHROMIUM_FLAGS = ["--font-render-hinting=none", "--force-color-profile=srgb"];

export default defineConfig({
  testDir: "e2e",
  testMatch: /\.spec\.ts$/,
  outputDir: "test-results",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  fullyParallel: true,
  workers: WORKERS,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.02
    }
  },
  use: {
    colorScheme: "dark",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    locale: "en-US",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "on-first-retry",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        launchOptions: { args: CHROMIUM_FLAGS }
      }
    },
    {
      name: "chromium-half",
      testMatch: LAYOUT_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 720, height: 900 },
        deviceScaleFactor: 1,
        launchOptions: { args: CHROMIUM_FLAGS }
      }
    },
    {
      name: "chromium-third",
      testMatch: LAYOUT_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 480, height: 900 },
        deviceScaleFactor: 1,
        launchOptions: { args: CHROMIUM_FLAGS }
      }
    },
    {
      name: "chromium-half-wide",
      testMatch: LAYOUT_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 960, height: 1080 },
        deviceScaleFactor: 1,
        launchOptions: { args: CHROMIUM_FLAGS }
      }
    },
    {
      name: "chromium-mobile",
      testMatch: /no-js-errors\.spec\.ts$/,
      use: {
        ...devices["Pixel 7"],
        deviceScaleFactor: 1,
        launchOptions: { args: CHROMIUM_FLAGS }
      }
    }
  ]
});
