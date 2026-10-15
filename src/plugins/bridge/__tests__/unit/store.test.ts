import { afterEach, describe, expect, it, vi } from "vitest";
import { readRemembered, rememberLink, writeRemembered } from "../../connection/pairing-store";
import { startWith } from "../../lifecycle";
import type { CheckpointStorage, RememberedLinks } from "../../types";
import { MAX_REMEMBERED, PAIRING_STORE_KEY } from "../../types";
import { createDeps, flush, LAN } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The remembered links in localStorage: read, write, at most MAX_REMEMBERED,
// a store that throws keeps the links in memory.
// ─────────────────────────────────────────────────────────────────────────────

/** A localStorage that throws on every call (private mode, storage off). */
const THROWING: CheckpointStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  }
};

/** Nothing remembered. */
const EMPTY: RememberedLinks = { v: 1, last: undefined, links: {} };

/**
 * Deps whose localStorage holds a text.
 *
 * @param text - The stored text.
 * @returns The deps.
 */
function storing(text: string) {
  const deps = createDeps();
  deps.linkStorage.setItem(PAIRING_STORE_KEY, text);
  return deps;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("readRemembered", () => {
  it("reads a v1 store, normalized, without the entries it cannot use", () => {
    const deps = storing(
      JSON.stringify({
        v: 1,
        last: " 192.168.1.5:47600 ",
        links: {
          [LAN]: { device: "d-7f3a", token: "t1" },
          "not an address": { device: "d-0001", token: "t2" },
          "10.0.0.7:47600": { device: 7, token: "t3" }
        }
      })
    );

    expect(readRemembered(deps)).toEqual({
      v: 1,
      last: LAN,
      links: { [LAN]: { device: "d-7f3a", token: "t1" } }
    });
  });

  it("reads a v2 store, broken JSON and an empty store as nothing remembered", () => {
    expect(readRemembered(storing(JSON.stringify({ v: 2, last: LAN, links: {} })))).toEqual(EMPTY);
    expect(readRemembered(storing("{"))).toEqual(EMPTY);
    expect(readRemembered(createDeps())).toEqual(EMPTY);
  });

  it("reads nothing from a throwing store and logs it at debug", () => {
    const deps = { ...createDeps(), linkStorage: THROWING };

    expect(readRemembered(deps)).toEqual(EMPTY);
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:storage-failed", { step: "read" });
  });
});

describe("writeRemembered", () => {
  it("keeps the links in memory when the store throws", () => {
    const deps = { ...createDeps(), linkStorage: THROWING };
    deps.state.remembered = rememberLink(EMPTY, LAN, { device: "d-7f3a", token: "t1" });

    expect(() => writeRemembered(deps)).not.toThrow();
    expect(deps.state.remembered.links[LAN]).toEqual({ device: "d-7f3a", token: "t1" });
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:storage-failed", { step: "write" });
  });
});

describe("rememberLink", () => {
  it("keeps the newest MAX_REMEMBERED addresses; pairing again makes an address the newest", () => {
    let remembered = EMPTY;
    for (let host = 1; host <= 6; host += 1) {
      remembered = rememberLink(remembered, `10.0.0.${String(host)}:47600`, {
        device: `d-000${String(host)}`,
        token: "t"
      });
    }
    remembered = rememberLink(remembered, "10.0.0.3:47600", { device: "d-0009", token: "t" });

    expect(Object.keys(remembered.links)).toEqual([
      "10.0.0.4:47600",
      "10.0.0.5:47600",
      "10.0.0.6:47600",
      "10.0.0.3:47600"
    ]);
    expect(Object.keys(remembered.links)).toHaveLength(MAX_REMEMBERED);
    expect(remembered.last).toBe("10.0.0.3:47600");
  });
});

describe("start with a throwing localStorage", () => {
  it("completes, resolves the mode and connects", async () => {
    vi.useFakeTimers();
    const deps = {
      ...createDeps({ flags: { editor: LAN, model: undefined, userAgent: undefined } }),
      linkStorage: THROWING
    };

    expect(() => {
      startWith(deps);
    }).not.toThrow();
    await flush();

    expect(deps.state.mode).toBe("device");
    expect(deps.net.sockets).toHaveLength(1);
  });
});
