/* eslint-disable sonarjs/no-clear-text-protocols -- the hub serves plain http on 127.0.0.1 */
import { describe, expect, it } from "vitest";
import { allowedHosts, allowedOrigins, guard, refusalOf, refuse } from "../../security/guard";
import type { GuardMode } from "../../types";
import { fakeServer, portlessServer } from "../helpers";

const P = 4000;
const NONE: ReadonlySet<string> = new Set();
const ALLOW: ReadonlySet<string> = new Set(["http://192.168.1.4:3000"]);

/**
 * A request to the editor socket path with the given headers.
 *
 * @param headers - Request headers.
 * @returns The request.
 */
function req(headers: Record<string, string>): Request {
  return new Request(`http://127.0.0.1:${P}/__editor/ws`, { headers });
}

/**
 * The default good headers, with overrides (undefined removes a header).
 *
 * @param overrides - Headers to change or remove.
 * @returns The headers.
 */
function headers(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    host: `127.0.0.1:${P}`,
    origin: `http://127.0.0.1:${P}`,
    ...overrides
  };
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * Runs guard in a mode.
 *
 * @param mode - Guard mode.
 * @param overrides - Header overrides.
 * @param allow - Extra origins.
 * @returns The status (200 when allowed).
 */
function statusOf(
  mode: GuardMode,
  overrides: Record<string, string | undefined> = {},
  allow: ReadonlySet<string> = NONE
): number {
  const refused = guard(req(headers(overrides)), fakeServer(P), mode, allow);
  return refused === undefined ? 200 : refused.status;
}

describe("allowedHosts and allowedOrigins", () => {
  it("allows 127.0.0.1 and localhost on the port", () => {
    expect([...allowedHosts(P)].toSorted()).toEqual([`127.0.0.1:${P}`, `localhost:${P}`]);
  });

  it("adds the bare hosts on port 80", () => {
    expect(allowedHosts(80)).toEqual(
      new Set(["127.0.0.1:80", "localhost:80", "127.0.0.1", "localhost"])
    );
  });

  it("allows the http origins of the port plus the configured ones", () => {
    expect(allowedOrigins(P, ALLOW)).toEqual(
      new Set([`http://127.0.0.1:${P}`, `http://localhost:${P}`, "http://192.168.1.4:3000"])
    );
  });

  it("adds the port-less origins on port 80", () => {
    expect(allowedOrigins(80, NONE)).toEqual(
      new Set([
        "http://127.0.0.1:80",
        "http://localhost:80",
        "http://127.0.0.1",
        "http://localhost"
      ])
    );
  });
});

describe("guard upgrade mode", () => {
  it("allows the default host and origin", () => {
    expect(statusOf("upgrade")).toBe(200);
  });

  it("refuses an evil origin (H4)", () => {
    expect(statusOf("upgrade", { origin: "http://evil.com" })).toBe(403);
  });

  it("refuses a missing Origin (H5, R6)", () => {
    expect(statusOf("upgrade", { origin: undefined })).toBe(403);
  });

  it("refuses the origin null (H6)", () => {
    expect(statusOf("upgrade", { origin: "null" })).toBe(403);
  });

  it("refuses another port (H7) and https (H8)", () => {
    expect(statusOf("upgrade", { origin: `http://127.0.0.1:${P + 1}` })).toBe(403);
    expect(statusOf("upgrade", { origin: `https://127.0.0.1:${P}` })).toBe(403);
  });

  it("allows localhost host and origin (H9)", () => {
    expect(statusOf("upgrade", { host: `localhost:${P}`, origin: `http://localhost:${P}` })).toBe(
      200
    );
  });

  it("allows an origin listed in config.allowOrigins (H10)", () => {
    expect(statusOf("upgrade", { origin: "http://192.168.1.4:3000" }, ALLOW)).toBe(200);
  });

  it("refuses DNS rebinding: evil host and origin (H11)", () => {
    expect(statusOf("upgrade", { host: `evil.com:${P}`, origin: `http://evil.com:${P}` })).toBe(
      403
    );
  });

  it("refuses an evil origin on the right host (H12)", () => {
    expect(statusOf("upgrade", { origin: `http://evil.com:${P}` })).toBe(403);
  });

  it("refuses a missing Host (H13)", () => {
    expect(statusOf("upgrade", { host: undefined })).toBe(403);
  });

  it("compares hosts exactly and case-insensitively (H14)", () => {
    expect(statusOf("upgrade", { host: `127.0.0.1.evil.com:${P}` })).toBe(403);
    expect(statusOf("upgrade", { host: `localhost.evil.com:${P}` })).toBe(403);
    expect(statusOf("upgrade", { host: `LOCALHOST:${P}` })).toBe(200);
  });

  it("refuses when the server has no port", () => {
    const refused = guard(req(headers()), portlessServer(), "upgrade", NONE);

    expect(refused?.status).toBe(403);
  });

  it("ignores Sec-Fetch-Site on upgrade", () => {
    expect(statusOf("upgrade", { "sec-fetch-site": "cross-site" })).toBe(200);
  });
});

describe("guard same-origin mode", () => {
  it("allows a request without Origin", () => {
    expect(statusOf("same-origin", { origin: undefined })).toBe(200);
  });

  it("refuses a present foreign Origin", () => {
    expect(statusOf("same-origin", { origin: "http://evil.com" })).toBe(403);
  });

  it("refuses Sec-Fetch-Site cross-site and same-site (H37)", () => {
    expect(statusOf("same-origin", { "sec-fetch-site": "cross-site" })).toBe(403);
    expect(statusOf("same-origin", { "sec-fetch-site": "same-site" })).toBe(403);
  });

  it("allows Sec-Fetch-Site same-origin and none", () => {
    expect(statusOf("same-origin", { "sec-fetch-site": "same-origin" })).toBe(200);
    expect(statusOf("same-origin", { "sec-fetch-site": "none" })).toBe(200);
  });

  it("still checks the host", () => {
    expect(statusOf("same-origin", { host: `evil.com:${P}`, origin: undefined })).toBe(403);
  });
});

describe("guard navigate mode", () => {
  it("allows a request without Origin and ignores Sec-Fetch-Site", () => {
    expect(statusOf("navigate", { origin: undefined, "sec-fetch-site": "cross-site" })).toBe(200);
  });

  it("refuses a present foreign Origin and a foreign host", () => {
    expect(statusOf("navigate", { origin: "http://evil.com" })).toBe(403);
    expect(statusOf("navigate", { host: "evil.com" })).toBe(403);
  });
});

describe("refusalOf", () => {
  it("names the failing check", () => {
    const server = fakeServer(P);

    expect(refusalOf(req(headers()), portlessServer(), "upgrade", NONE)).toBe("port");
    expect(refusalOf(req(headers({ host: "evil.com" })), server, "upgrade", NONE)).toBe("host");
    expect(refusalOf(req(headers({ origin: undefined })), server, "upgrade", NONE)).toBe("origin");
    expect(
      refusalOf(req(headers({ "sec-fetch-site": "cross-site" })), server, "same-origin", NONE)
    ).toBe("fetch-site");
    expect(refusalOf(req(headers()), server, "upgrade", NONE)).toBeUndefined();
  });
});

describe("refuse", () => {
  it("builds a plain, uncached one-word refusal", async () => {
    const response = refuse(403, "forbidden");

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("forbidden");
  });

  it("is what guard returns", async () => {
    const refused = guard(req(headers({ origin: "null" })), fakeServer(P), "upgrade", NONE);

    expect(refused?.headers.get("cache-control")).toBe("no-store");
    expect(await refused?.text()).toBe("forbidden");
  });
});
