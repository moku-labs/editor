/**
 * @file The dev flags of the tiny e2e game page, as `moku-game dev` writes them in `.moku/dev.ts`
 * (engine `devFlag`). `main.ts` imports this module first, so the flags are set before the engine
 * runs: the dev flag makes the `/control` commands of the editor work on the page, the agent flag
 * gives the renderer its performance monitor, whose frames the editor's perf reads (without it the
 * monitor's ring has capacity 0, perf waits for ever and the Render strip shows no frame).
 */
Reflect.set(globalThis, "__MOKU_GAME_AGENT__", true);
Reflect.set(globalThis, "__MOKU_GAME_DEV__", true);
