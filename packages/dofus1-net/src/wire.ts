// Class + decorator based wire-message system.
//
// Each message is a class. Field decorators describe the wire layout
// (position, type, separator). The class decorator (`@WireIn` /
// `@WireOut`) ties the class to an opcode and registers it with the
// dispatcher.
//
// Compared to the old `defineMessage({ opcode, parse, serialize })`
// literals, this gets us:
//   - Class instances at the call site (typed methods, instanceof
//     checks, real OO if you want it).
//   - No hand-rolled split + index + coerce; the framework derives
//     parse + serialize from field metadata.
//   - One class is both the type AND the runtime — no parallel
//     `XPayload` type to keep in sync.
//   - Compositional: composite rows are themselves classes,
//     `@F.trailing(idx, RowClass)` consumes the tail as a list.
//
// Escape hatches:
//   - `@WireIn` accepts a `parse` override for messages whose wire
//     format doesn't fit the positional model (e.g. packed IP+port,
//     hex-prefixed crypto blobs).
//   - `@WireOut` accepts a `serialize` override for the same.
//   - Truly custom shapes can still use the underlying
//     `defineMessage` directly.

import { match, P } from "ts-pattern";

import { defineMessage, type MessageDef } from "./registry";

const FIELDS_META = Symbol.for("dofus1net.fields");
const SCHEMA_META = Symbol.for("dofus1net.schema");

export type ScalarKind =
  | "str"
  | "int"
  | "int16"
  | "int36"
  | "hexChar"
  | "bool"
  | "raw";

interface FieldMeta {
  name: string;
  index: number;
  kind: ScalarKind;
  /** Default value when the cell is missing or empty. */
  default?: unknown;
  /** For list cells: split the cell by `listSep` and coerce each item. */
  listKind?: ScalarKind;
  listSep?: string;
  /** Consume cells [index..] joined back with the parent separator. */
  rest?: boolean;
  /** Trailing list of composite-class rows starting at `index`. */
  trailing?: { itemCls: WireClass };
}

interface CompositeSchema {
  kind: "composite";
  separator: string;
  fields: FieldMeta[];
}

interface WireSchema {
  kind: "wire";
  opcode: string;
  direction: "in" | "out";
  bodyOffset: number;
  separator: string;
  fields: FieldMeta[];
  /** Override the auto parse — used when wire shape isn't positional. */
  parse?: (body: string, errorFlag: boolean) => object;
  /** Override the auto serialize — used when wire shape isn't positional. */
  serialize?: (instance: object) => string;
}

type Schema = WireSchema | CompositeSchema;

/** Anything decorated with @WireIn/@WireOut/@Composite. */
export interface WireClass<T extends object = object> {
  new (...args: never[]): T;
  [SCHEMA_META]?: Schema;
}

/** Inbound class — guaranteed `[SCHEMA_META]` is a WireSchema with direction "in". */
export interface WireInClass<T extends object = object> {
  new (): T;
  [SCHEMA_META]: WireSchema;
}

/** Outbound class — `[SCHEMA_META]` is a WireSchema with direction "out". */
export interface WireOutClass<T extends object = object> {
  new (...args: never[]): T;
  [SCHEMA_META]: WireSchema;
}

function pushField(
  target: object,
  propertyKey: string,
  meta: Omit<FieldMeta, "name">
): void {
  const list = ((target as Record<symbol, unknown>)[FIELDS_META] ??
    []) as FieldMeta[];

  list.push({ name: propertyKey, ...meta });

  (target as Record<symbol, unknown>)[FIELDS_META] = list;
}

/**
 * Field decorators. Each one annotates a class property with the
 * wire-format position and coercion to apply when parsing the
 * separator-split body.
 */
export const F = {
  /** ASCII string at cell `index`. */
  str(index: number, opts?: { default?: string }) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "str", default: opts?.default ?? "" });
  },
  /** Base-10 integer at cell `index`. */
  int(index: number, opts?: { default?: number }) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "int", default: opts?.default ?? 0 });
  },
  /** Base-16 integer at cell `index`. */
  int16(index: number, opts?: { default?: number }) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "int16", default: opts?.default ?? 0 });
  },
  /** Base-36 integer at cell `index` — used by Account.as#onRestrictions. */
  int36(index: number, opts?: { default?: number }) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "int36", default: opts?.default ?? 0 });
  },
  /** Single hex char (e.g. crypto key id) at cell `index`. */
  hexChar(index: number) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "hexChar" });
  },
  /** "0"/"1" boolean at cell `index`. */
  bool(index: number) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "bool" });
  },
  /** Raw string (no coercion). */
  raw(index: number) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "raw" });
  },
  /**
   * Capture cells from `index` onwards rejoined with the parent
   * separator. Use for "the rest of the frame is opaque" tail fields.
   */
  rest(index: number) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "raw", rest: true });
  },
  /**
   * A single cell that's itself a list (e.g. semicolon-separated
   * inside a pipe-separated body).
   */
  list(index: number, opts: { sep?: string; kind?: ScalarKind } = {}) {
    return (t: object, k: string): void =>
      pushField(t, k, {
        index,
        kind: "raw",
        listKind: opts.kind ?? "str",
        listSep: opts.sep ?? ";",
      });
  },
  /**
   * Trailing list of composite-class rows. Each cell from `index`
   * onwards is parsed as an instance of `itemCls`.
   *
   * `itemCls` must be a class decorated with `@Composite`.
   */
  trailing<T extends object>(index: number, itemCls: WireClass<T>) {
    return (t: object, k: string): void =>
      pushField(t, k, { index, kind: "raw", trailing: { itemCls } });
  },
};

function readFields(cls: WireClass): FieldMeta[] {
  const raw = ((cls.prototype as Record<symbol, unknown>)[FIELDS_META] ??
    []) as FieldMeta[];

  return [...raw].sort((a, b) => a.index - b.index);
}

export interface CompositeOpts {
  separator?: string;
}

/**
 * Mark a class as a composite row (used inside `@F.trailing` lists).
 * Composites have their own separator (`;` by default) distinct from
 * the parent wire frame's separator.
 */
export function Composite(opts: CompositeOpts = {}) {
  return <T extends WireClass>(cls: T): T => {
    const schema: CompositeSchema = {
      kind: "composite",
      separator: opts.separator ?? ";",
      fields: readFields(cls),
    };

    cls[SCHEMA_META] = schema;

    return cls;
  };
}

export interface WireInOpts {
  opcode: string;
  bodyOffset?: number;
  separator?: string;
  /** Override the auto-parser. Receives the body string + AS2 error flag hint. */
  parse?: (body: string, errorFlag: boolean) => object;
}

/**
 * Decorate an inbound message class. Registers the opcode with the
 * dispatcher; the parsed frame becomes an instance of the class.
 */
export function WireIn(opts: WireInOpts) {
  return <T extends WireClass>(cls: T): T => {
    const fields = readFields(cls);
    const schema: WireSchema = {
      kind: "wire",
      opcode: opts.opcode,
      direction: "in",
      bodyOffset: opts.bodyOffset ?? 2,
      separator: opts.separator ?? "|",
      fields,
      parse: opts.parse,
    };

    cls[SCHEMA_META] = schema;

    registerInboundClass(cls);

    return cls;
  };
}

export interface WireOutOpts {
  opcode: string;
  separator?: string;
  /** Override the auto-serializer. */
  serialize?: (instance: object) => string;
}

/**
 * Decorate an outbound message class. Instances are passed to
 * `Client.send(instance)` which produces the wire frame.
 */
export function WireOut(opts: WireOutOpts) {
  return <T extends WireClass>(cls: T): T => {
    const fields = readFields(cls);
    const schema: WireSchema = {
      kind: "wire",
      opcode: opts.opcode,
      direction: "out",
      bodyOffset: 0,
      separator: opts.separator ?? "|",
      fields,
      serialize: opts.serialize,
    };

    cls[SCHEMA_META] = schema;

    return cls;
  };
}

function coerceIn(
  s: string | undefined,
  kind: ScalarKind,
  defaultVal?: unknown
): unknown {
  if (s === undefined || s === "") {
    if (defaultVal !== undefined) {
      return defaultVal;
    }

    return match(kind)
      .with("int", "int16", "int36", "hexChar", () => 0)
      .with("bool", () => false)
      .with("str", "raw", () => "")
      .exhaustive();
  }

  return match(kind)
    .with("str", "raw", () => s)
    .with("int", () => {
      const n = Number.parseInt(s, 10);

      return Number.isNaN(n) ? 0 : n;
    })
    .with("int16", () => {
      const n = Number.parseInt(s, 16);

      return Number.isNaN(n) ? 0 : n;
    })
    .with("int36", () => {
      const n = Number.parseInt(s, 36);

      return Number.isNaN(n) ? 0 : n;
    })
    .with("hexChar", () => {
      const n = Number.parseInt(s.charAt(0) || "0", 16);

      return Number.isNaN(n) ? 0 : n;
    })
    .with("bool", () => s !== "0")
    .exhaustive();
}

function coerceOut(v: unknown, kind: ScalarKind): string {
  if (v === undefined || v === null) {
    return "";
  }

  return match(kind)
    .with("bool", () => (v ? "1" : "0"))
    .with("hexChar", () => "0123456789ABCDEF"[Number(v) & 0xf] as string)
    .with("int16", () => Number(v).toString(16).toUpperCase())
    .with("int36", () => Number(v).toString(36))
    .otherwise(() => String(v));
}

function parseInstance<T extends object>(
  cls: WireClass<T>,
  body: string,
  schema: WireSchema | CompositeSchema
): T {
  const sep = schema.separator;
  const parts =
    body === "" ? [] : sep === "" ? body.split("") : body.split(sep);
  const instance = new (cls as unknown as new () => T)();

  for (const f of schema.fields) {
    const value = match(f)
      .with({ rest: true }, () => parts.slice(f.index).join(sep))
      .with({ trailing: P.select(P.nonNullable) }, (trailing) => {
        const itemSchema = trailing.itemCls[SCHEMA_META] as CompositeSchema;

        return parts
          .slice(f.index)
          .map((row) => parseInstance(trailing.itemCls, row, itemSchema));
      })
      .with({ listSep: P.string }, ({ listSep, listKind }) => {
        const cell = parts[f.index];
        const items =
          cell === undefined || cell === "" ? [] : cell.split(listSep);
        return items.map((it) => coerceIn(it, listKind ?? "str"));
      })
      .otherwise(() => coerceIn(parts[f.index], f.kind, f.default));

    (instance as Record<string, unknown>)[f.name] = value;
  }
  return instance;
}

function serializeInstance(
  instance: object,
  schema: WireSchema | CompositeSchema
): string {
  const sep = schema.separator;
  let maxIdx = -1;

  for (const f of schema.fields) {
    if (!f.trailing && f.index > maxIdx) {
      maxIdx = f.index;
    }
  }

  const cells: string[] = Array(maxIdx + 1).fill("");
  let trailingCells: string[] = [];

  for (const f of schema.fields) {
    const val = (instance as Record<string, unknown>)[f.name];

    match(f)
      .with({ trailing: P.select(P.nonNullable) }, (trailing) => {
        const itemSchema = trailing.itemCls[SCHEMA_META] as CompositeSchema;

        const rows = (val as object[]).map((row) =>
          serializeInstance(row, itemSchema)
        );

        trailingCells = trailingCells.concat(rows);
      })
      .with({ listSep: P.string }, ({ listSep, listKind }) => {
        cells[f.index] = (val as unknown[])
          .map((v) => coerceOut(v, listKind ?? "str"))
          .join(listSep);
      })
      .with({ rest: true }, () => {
        cells[f.index] = String(val ?? "");
      })
      .otherwise(() => {
        cells[f.index] = coerceOut(val, f.kind);
      });
  }

  const all = trailingCells.length === 0 ? cells : cells.concat(trailingCells);

  return all.join(sep);
}

/** Look up an inbound class's opcode (used by `Client.on`). */
export function opcodeOf(cls: WireClass): string | undefined {
  const s = cls[SCHEMA_META] as Schema | undefined;

  return s && s.kind === "wire" ? s.opcode : undefined;
}

/** Build the wire frame for an outbound instance (used by `Client.send`). */
export function buildOutboundFrame(instance: object): string {
  const schema = (instance.constructor as unknown as Record<symbol, unknown>)[
    SCHEMA_META
  ] as WireSchema | undefined;

  if (!schema || schema.kind !== "wire" || schema.direction !== "out") {
    throw new Error(
      `buildOutboundFrame: instance is not a @WireOut class: ${instance.constructor.name}`
    );
  }

  const body = schema.serialize
    ? schema.serialize(instance)
    : serializeInstance(instance, schema);

  return schema.opcode + body;
}

function registerInboundClass<T extends object>(cls: WireClass<T>): void {
  const schema = (cls as unknown as Record<symbol, unknown>)[
    SCHEMA_META
  ] as WireSchema;

  const customParse = schema.parse;
  const def: MessageDef<T> = {
    opcode: schema.opcode,
    direction: "in",
    bodyOffset: schema.bodyOffset,
    parse:
      customParse !== undefined
        ? (body, errorFlag) => customParse(body, errorFlag) as T
        : (body) => parseInstance(cls, body, schema),
  };

  defineMessage(def);
}

/** @internal */
export const _internal = {
  FIELDS_META,
  SCHEMA_META,
  parseInstance,
  serializeInstance,
} as const;
