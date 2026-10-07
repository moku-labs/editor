import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    // ".": runtime-free protocol and definePanel.
    index: "src/index.ts",
    // Subpaths, one per runtime (D-01): the game page, the Bun server, the tools page.
    agent: "src/agent.ts",
    // The page agent the engine page starts (D-49): `./agent/page`, a default export.
    "agent-page": "src/agent-page.ts",
    server: "src/server.ts",
    tools: "src/tools.ts",
    // The moku-editor bin (package.json "bin"); keeps its #!/usr/bin/env bun line.
    bin: "src/plugins/pages/bin.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  tsconfig: "tsconfig.build.json"
});
