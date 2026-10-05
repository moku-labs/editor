/**
 * @file pages/mcp — the package version the bridge reports in `serverInfo` (M1), imported from
 * package.json at build time: the bundler inlines it into dist/bin.mjs.
 */
import { version } from "../../../../package.json";

/**
 * The version of `@moku-labs/editor`.
 */
export const VERSION: string = version;
