/**
 * @file flowView plugin — the store hooks of the Flow components: `useFlowStore` re-renders a
 * component when the value it selects from the state changes (data changes, or camera moves on the
 * camera channel), `useElement` holds a rendered element without a null ref.
 */
import { useLayoutEffect, useReducer, useRef, useState } from "preact/hooks";
import { subscribe } from "./state";
import type { FlowCtx, FlowViewState } from "./types";

/**
 * Shallow equality: the same value, or arrays / plain objects with the same entries.
 *
 * @param a - A value.
 * @param b - A value.
 * @returns Whether the two are shallowly equal.
 * @example
 * ```ts
 * shallowEqual({ a: 1 }, { a: 1 }); // true
 * ```
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return (
    keysA.length === keysB.length &&
    keysA.every(key => Object.is(Reflect.get(a, key), Reflect.get(b, key)))
  );
}

/**
 * Selects a value from the flowView state and re-renders the component when it changes.
 *
 * @param ctx - Domain context of flowView.
 * @param select - Reads the value from the state.
 * @param channel - "data" (default) or "camera".
 * @returns The selected value.
 */
export function useFlowStore<T>(
  ctx: FlowCtx,
  select: (state: FlowViewState) => T,
  channel: "data" | "camera" = "data"
): T {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const value = select(ctx.state);
  const latest = useRef({ select, value });
  latest.current = { select, value };

  useLayoutEffect(
    () =>
      subscribe(
        ctx.state,
        () => {
          const next = latest.current.select(ctx.state);
          if (!shallowEqual(next, latest.current.value)) rerender(1);
        },
        channel
      ),
    [ctx, channel]
  );
  return value;
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
 * const canvas = useElement<HTMLDivElement>();
 * return <div ref={canvas.ref} />;
 * ```
 */
export function useElement<T>(): ElementHolder<T> {
  const [holder] = useState(() => {
    const created: ElementHolder<T> = {
      current: undefined,
      /**
       * Keeps the rendered element (undefined once it unmounts).
       *
       * @param element - The element, or null.
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
