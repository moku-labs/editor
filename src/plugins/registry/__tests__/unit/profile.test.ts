import { afterEach, describe, expect, it, vi } from "vitest";
import { readBuildInfo } from "../../entries/profile";
import { stubBuild } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// readBuildInfo: the page's build from the engine's flags (spec 10 F1/F3), read
// from globalThis
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readBuildInfo", () => {
  it("is dev when the dev flag is true, whatever the other flags say", () => {
    stubBuild({ dev: true, control: true, agent: true });

    expect(readBuildInfo().profile).toBe("dev");
  });

  it("is full when the control flag is true without the dev flag", () => {
    stubBuild({ dev: false, control: true, agent: true });

    expect(readBuildInfo().profile).toBe("full");
  });

  it("is read when only the agent flag is true", () => {
    stubBuild({ agent: true });

    expect(readBuildInfo().profile).toBe("read");
  });

  it("is none without any flag (a release page, a test without stubs)", () => {
    stubBuild({});

    expect(readBuildInfo()).toEqual({ profile: "none" });
  });

  it("does not take the string 'true' for a flag (a define that did not fold)", () => {
    stubBuild({ dev: "true", control: "true", agent: "true" });

    expect(readBuildInfo().profile).toBe("none");
  });

  it("carries the build id and the engine fingerprint when they are strings", () => {
    stubBuild({ agent: true, build: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" });

    expect(readBuildInfo()).toEqual({
      profile: "read",
      id: "debug-20261014T160000Z",
      engine: "0.14.12+9c41e0"
    });
  });

  it("leaves out an id or an engine that is not a string (no null in the manifest)", () => {
    // eslint-disable-next-line unicorn/no-null -- a global the page set to null
    stubBuild({ dev: true, build: 42, engine: null });

    const build = readBuildInfo();

    expect(build).toEqual({ profile: "dev" });
    expect("id" in build).toBe(false);
    expect("engine" in build).toBe(false);
  });

  it("answers a frozen object", () => {
    stubBuild({ dev: true });

    expect(Object.isFrozen(readBuildInfo())).toBe(true);
  });
});
