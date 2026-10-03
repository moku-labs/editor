/**
 * @file link plugin — the boot JSON the server injected into the tools page (R1/R3) and its
 * refresh through the same-origin hello route after a socket that never opened (R7).
 */
import type { Json, ToolsBoot } from "../../registry/protocol";
import { readHelloBody, readToolsBoot } from "../rpc/shapes";

/**
 * The URL of the tools page, or undefined outside a page (a bare Bun process).
 *
 * @returns `location.href` when there is a location.
 * @example
 * ```ts
 * const origin = bootOrigin(boot.ws, pageHref() ?? boot.ws);
 * ```
 */
export function pageHref(): string | undefined {
  return globalThis.location?.href;
}

/**
 * Reads and checks the `ToolsBoot` JSON of the boot tag.
 *
 * @param selector - CSS selector of the JSON script tag (config.boot).
 * @param doc - The document, undefined outside a page.
 * @returns The boot data; undefined for a missing tag, bad JSON, another `v` or a missing field.
 * @example
 * ```ts
 * const boot = readBoot("#moku-editor-boot", globalThis.document);
 * ```
 */
export function readBoot(selector: string, doc: Document | undefined): ToolsBoot | undefined {
  try {
    const text = doc?.querySelector(selector)?.textContent;
    if (!text) return undefined;

    const parsed: Json = JSON.parse(text);
    return readToolsBoot(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Fetches `{path}/hello` on the page origin for a fresh `{ ws, token }` (the hub rotates the token
 * per start) and merges it into the boot; the other fields stay. Never rejects.
 *
 * @param boot - The current boot data.
 * @returns The refreshed boot, or undefined when the fetch fails or answers a bad body.
 * @example
 * ```ts
 * const fresh = await refreshBoot(state.boot);
 * ```
 */
export async function refreshBoot(boot: ToolsBoot): Promise<ToolsBoot | undefined> {
  try {
    const base = pageHref();
    const url = new URL(`${boot.path}/hello`, base);
    const response = await fetch(url.href, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return undefined;

    const parsed: Json = JSON.parse(await response.text());
    const hello = readHelloBody(parsed);
    if (hello === undefined) return undefined;

    return { ...boot, ws: new URL(hello.ws, base).href, token: hello.token };
  } catch {
    return undefined;
  }
}
