/**
 * @file The dev flag of the tiny e2e game page. `main.ts` imports this module first, so the flag
 * is set before the engine runs and the `/control` commands of the editor work on the page.
 */
Reflect.set(globalThis, "__MOKU_GAME_DEV__", true);
