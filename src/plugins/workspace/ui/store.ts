/**
 * @file workspace plugin — the tiny UI store: a version number the Preact components re-render
 * from. Domain code changes the state and calls `bump()`; `useWorkspace` subscribes a component.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import type { UiStore } from "../types";

/**
 * Creates the UI store.
 *
 * @returns A store at version 0 with no subscribers.
 * @example
 * ```ts
 * const ui = createUiStore();
 * ui.subscribe(() => redraw());
 * ui.bump();
 * ```
 */
export function createUiStore(): UiStore {
  const subscribers = new Set<() => void>();
  const store: UiStore = {
    version: 0,

    /**
     * Adds a subscriber.
     *
     * @param fn - Called after every bump.
     * @returns Unsubscribe.
     * @example
     * ```ts
     * const off = store.subscribe(() => redraw());
     * ```
     */
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    /**
     * Raises the version and calls every subscriber.
     *
     * @example
     * ```ts
     * ctx.state.active = "game";
     * ctx.state.ui.bump();
     * ```
     */
    bump() {
      store.version += 1;
      for (const fn of subscribers) fn();
    }
  };
  return store;
}

/**
 * Re-renders the calling component on every `bump()` and returns the selected value.
 *
 * @param store - The UI store of the workspace state.
 * @param select - Reads the value from the state at render time.
 * @returns The selected value.
 * @example
 * ```tsx
 * const active = useWorkspace(ctx.state.ui, () => ctx.state.active);
 * ```
 */
export function useWorkspace<T>(store: UiStore, select: () => T): T {
  const [, setVersion] = useState(store.version);

  useLayoutEffect(() => {
    /**
     * Copies the store version into the component state (a changed number re-renders).
     *
     * @example
     * ```ts
     * store.subscribe(sync);
     * ```
     */
    const sync = (): void => {
      setVersion(store.version);
    };
    sync();
    return store.subscribe(sync);
  }, [store]);

  return select();
}

/**
 * An element reference for Preact's `ref` prop that starts undefined.
 */
export type ElementHolder<T> = {
  current: T | undefined;
  readonly ref: (element: T | null) => void;
};

/**
 * Holds a rendered element across renders.
 *
 * @returns The holder: pass `holder.ref` as `ref`, read `holder.current` in effects.
 * @example
 * ```tsx
 * const body = useElement<HTMLDivElement>();
 * return <div ref={body.ref} />;
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
