/**
 * The e2e suite of the tools page. The webServer builds the package (tsdown and the tools page
 * bundle), copies the frozen merge-game fixture into dist-e2e/game (e2e/prepare-game.ts) and
 * serves it with the real bin: the game page at `/`, the tools page at `/__editor/`. Its stdout
 * and stderr go to dist-e2e/server.log, which e2e/global-teardown.ts scans for errors.
 *
 * One worker: the bin hosts one game link, and every test opens its own tools page and game frame
 * on it. Chromium runs the full suite on desktop (1440×900), on the two half-screen windows
 * (720×900, 960×1080) and on the third-screen window of the Claude pane (480×900). Phones are out
 * of scope (no mobile layout, D-21): the Pixel 7 project only runs the boot guard,
 * e2e/no-js-errors.spec.ts.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 4317);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVE = [
  "bun run build",
  "bun e2e/prepare-game.ts",
  `bun dist/bin.mjs dist-e2e/game/web/editor.html --port ${PORT} --root dist-e2e/game`
].join(" && ");

const CHROMIUM_FLAGS = ["--font-render-hinting=none", "--force-color-profile=srgb"];

export default defineConfig({
  testDir: "e2e",
  testMatch: /\.spec\.ts$/,
  outputDir: "test-results",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
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
    baseURL: BASE_URL,
    colorScheme: "dark",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    locale: "en-US",
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
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 720, height: 900 },
        deviceScaleFactor: 1,
        launchOptions: { args: CHROMIUM_FLAGS }
      }
    },
    {
      name: "chromium-third",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 480, height: 900 },
        deviceScaleFactor: 1,
        launchOptions: { args: CHROMIUM_FLAGS }
      }
    },
    {
      name: "chromium-half-wide",
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
  ],
  webServer: process.env.PW_EXTERNAL_SERVER
    ? []
    : {
        command: `mkdir -p dist-e2e && (${SERVE}) > dist-e2e/server.log 2>&1`,
        url: `${BASE_URL}/__editor/`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000
      }
});
