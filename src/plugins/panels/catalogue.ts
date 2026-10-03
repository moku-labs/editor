/**
 * @file panels plugin — the type map from source ids to wire values and from command ids to
 * their inputs (type-only, 11-panels "Typing spike": passed, so this is the typed map, not the
 * Json fallback). Built from `@moku-labs/game/inspect` and `/control` with type imports only, so
 * no game code is ever bundled. Ids of `.dev` modules and unknown ids stay `Json`.
 */
import type { commands } from "@moku-labs/game/control";
import type { InputOf, InputSchema, sources } from "@moku-labs/game/inspect";
import type { Json } from "../registry/protocol";

/**
 * The engine's sources, keyed by short name.
 */
type Sources = typeof sources;

/**
 * The engine's commands, keyed by short name.
 */
type Commands = typeof commands;

/**
 * Any function type: dropped by the wire.
 */
type AnyFunction = (...args: never[]) => unknown;

/**
 * Shows an intersection of mapped types as one object type.
 */
type Flat<T> = { [K in keyof T]: T[K] };

/**
 * True when a key's value is a function (the wire drops the key).
 */
type IsFunction<V> = [V] extends [AnyFunction] ? true : false;

/**
 * The keys of an object that the wire always carries: string keys whose value is neither a
 * function nor possibly undefined.
 */
type RequiredWireKeys<T> = {
  [K in keyof T]-?: K extends string
    ? IsFunction<T[K]> extends true
      ? never
      : undefined extends T[K]
        ? never
        : K
    : never;
}[keyof T];

/**
 * The keys of an object the wire may drop: string keys whose value may be undefined.
 */
type OptionalWireKeys<T> = {
  [K in keyof T]-?: K extends string
    ? IsFunction<T[K]> extends true
      ? never
      : undefined extends T[K]
        ? K
        : never
    : never;
}[keyof T];

/**
 * An object on the wire: function-valued keys dropped, undefined-able keys optional, the rest
 * recursed.
 */
type WireObject<T> = Flat<
  { -readonly [K in RequiredWireKeys<T>]: Wire<T[K]> } & {
    -readonly [K in OptionalWireKeys<T>]?: Wire<Exclude<T[K], undefined>>;
  }
>;

/**
 * What `toWireValue` makes of a value of type `T` (contracts §2, R1, R6): primitives stay,
 * `undefined` at top level becomes `null`, functions, symbols and bigint are `never`,
 * `ReadonlyMap` → `{ $map: [key, value][] }`, `ReadonlySet` → `{ $set: value[] }`, `Error` →
 * `{ $error: { name, message } }`, arrays keep their items with `undefined` as `null`, objects
 * drop function keys and make undefined-able keys optional. `unknown` and `any` are `Json`.
 *
 * @example
 * ```ts
 * type Position = Wire<{ path: string; flow: string | undefined }>; // { path: string; flow?: string }
 * ```
 */
export type Wire<T> = unknown extends T
  ? Json
  : T extends undefined
    ? null
    : T extends null | boolean | number | string
      ? T
      : T extends AnyFunction | symbol | bigint
        ? never
        : T extends ReadonlyMap<infer Key, infer Value>
          ? { $map: [Wire<Key>, Wire<Value>][] }
          : T extends ReadonlySet<infer Value>
            ? { $set: Wire<Value>[] }
            : T extends Error
              ? { $error: { name: string; message: string } }
              : T extends readonly (infer Item)[]
                ? Wire<Item>[]
                : T extends object
                  ? WireObject<T>
                  : Json;

/**
 * The input value of a schema, `never` for anything that is not one.
 */
type InputOfSchema<S> = S extends InputSchema ? InputOf<S> : never;

/**
 * Source id → wire value type of the game's door sources (`game.<key>` → the value its `read`
 * returns, as the wire carries it).
 *
 * @example
 * ```ts
 * type Position = GameSourceValues["game.position"]; // { path: string; flow?: string; … }
 * ```
 */
export type GameSourceValues = {
  [K in keyof Sources as `game.${K & string}`]: Wire<ReturnType<Sources[K]["read"]>>;
};

/**
 * Command id → input type of the game's door commands (`game.<key>` → `InputOf` its schema).
 *
 * @example
 * ```ts
 * type Step = GameCommandInputs["game.step"]; // { frames: number; deltaMs?: number | undefined }
 * ```
 */
export type GameCommandInputs = {
  [K in keyof Commands as `game.${K & string}`]: InputOfSchema<Commands[K]["input"]>;
};

/**
 * The value type a panel gets for a source id; unknown ids (and `.dev` ids) are Json.
 *
 * @example
 * ```ts
 * type Position = SourceValue<"game.position">;
 * ```
 */
export type SourceValue<Id extends string> = Id extends keyof GameSourceValues
  ? GameSourceValues[Id]
  : Json;

/**
 * The argument list of `tools.run.<name>` for a command id: required when the schema has a
 * required field, optional otherwise; `[input?: Json]` for unknown ids.
 *
 * @example
 * ```ts
 * type StepArgs = CommandArgs<"game.step">; // [input: { frames: number; deltaMs?: number | undefined }]
 * ```
 */
export type CommandArgs<Id> = Id extends keyof GameCommandInputs
  ? Partial<GameCommandInputs[Id]> extends GameCommandInputs[Id]
    ? [input?: GameCommandInputs[Id]]
    : [input: GameCommandInputs[Id]]
  : [input?: Json];
