/**
 * @file filesView plugin — view hooks: `useFiles` re-renders on every filesView change;
 * `useElement` holds a rendered element without a null ref.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import type { FilesViewApi } from "../types";

/**
 * A rendered element and the ref callback that stores it.
 */
export type ElementHolder<T> = {
  current: T | undefined;
  readonly ref: (element: T | null) => void;
};

/**
 * Re-renders the component after every filesView change and returns a fresh selection.
 *
 * @param api - The filesView api.
 * @param select - Reads what the component shows.
 * @returns The selection of this render.
 * @example
 * ```ts
 * const tabs = useFiles(api, () => api.tabs());
 * ```
 */
export function useFiles<T>(api: FilesViewApi, select: () => T): T {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => api.subscribe(() => setVersion(version => version + 1)), [api]);
  return select();
}

/**
 * Holds the element a `ref` attaches (undefined before mount and after unmount).
 *
 * @returns The holder; pass `holder.ref` as the ref.
 * @example
 * ```tsx
 * const body = useElement<HTMLDivElement>();
 * <div ref={body.ref} />
 * ```
 */
export function useElement<T>(): ElementHolder<T> {
  const [holder] = useState(() => {
    const created: ElementHolder<T> = {
      current: undefined,
      /**
       * Stores the element Preact attached (undefined after unmount).
       *
       * @param element - The element, or null on unmount.
       * @example
       * ```tsx
       * <div ref={holder.ref} />
       * ```
       */
      ref: element => {
        created.current = element ?? undefined;
      }
    };
    return created;
  });
  return holder;
}
