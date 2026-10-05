// ─────────────────────────────────────────────────────────────────────────────
// The JSON-RPC frame the MCP bridge writes to stdout, as its tests read it.
// Shared by unit/mcp/bridge.test.ts and the root tests/integration/mcp-bridge.test.ts,
// so both read the frames by one shape.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One frame the bridge wrote: a response (`id` with `result` or `error`) or a notification
 * (`method`). `result` stays `unknown`: each test narrows the answer it expects.
 */
export type RpcFrame = {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
};
