/**
 * @file bridge plugin — connection/hello.ts (skeleton stubs, implemented in its wave).
 */
import type { HelloBody } from "../../registry/protocol";
import type { BridgeNet } from "../types";

/**
 * Skeleton stub for `resolveHelloUrl`; implemented in its wave.
 *
 * @param _hello - The hello.
 * @param _href - The href.
 * @example
 * ```ts
 * resolveHelloUrl();
 * ```
 */
export function resolveHelloUrl(_hello: string, _href: string | undefined): URL | undefined {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `fetchHello`; implemented in its wave.
 *
 * @param _net - The net.
 * @param _url - The url.
 * @param _headers - The headers.
 * @example
 * ```ts
 * fetchHello();
 * ```
 */
export function fetchHello(
  _net: BridgeNet,
  _url: URL,
  _headers: Record<string, string> | undefined
): Promise<HelloBody> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `socketUrl`; implemented in its wave.
 *
 * @param _helloUrl - The helloUrl.
 * @param _body - The body.
 * @example
 * ```ts
 * socketUrl();
 * ```
 */
export function socketUrl(_helloUrl: URL, _body: HelloBody): URL {
  throw new Error("not implemented");
}
