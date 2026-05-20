// Opcode → MessageDef map. Per-message files register themselves at
// import time via @WireIn (or the low-level `defineMessage` escape
// hatch). `dispatch()` reads parsers from here.

export type Direction = "in" | "out" | "bi";

export type ParseFn<T> = (body: string, errorFlag: boolean) => T;
export type SerializeFn<T> = (payload: T) => string;

export interface MessageDef<T = unknown> {
  /** 2-char ASCII opcode (e.g. "HC", "Al", "GC"). Case-sensitive. */
  opcode: string;
  direction: Direction;
  /**
   * Characters to strip from the front of the wire frame before
   * passing the remainder to `parse`. Matches the AS2
   * `DataProcessor#postProcess` `substr(N)` per case (2 = opcode,
   * 3 = opcode + status char, 4 = opcode + 2 chars).
   */
  bodyOffset?: number;
  parse?: ParseFn<T>;
  serialize?: SerializeFn<T>;
}

export type InboundDef<T = unknown> = MessageDef<T> & {
  direction: "in" | "bi";
  parse: ParseFn<T>;
};

export type OutboundDef<T = unknown> = MessageDef<T> & {
  direction: "out" | "bi";
  serialize: SerializeFn<T>;
};

const registry = new Map<string, MessageDef<unknown>>();

export function defineMessage<T>(def: MessageDef<T>): MessageDef<T> {
  if (def.opcode.length < 1) {
    throw new Error(
      `defineMessage: opcode must be at least 1 char; got "${def.opcode}"`
    );
  }

  if ((def.direction === "in" || def.direction === "bi") && !def.parse) {
    throw new Error(`defineMessage(${def.opcode}): inbound requires parse()`);
  }

  if ((def.direction === "out" || def.direction === "bi") && !def.serialize) {
    throw new Error(
      `defineMessage(${def.opcode}): outbound requires serialize()`
    );
  }

  if (registry.has(def.opcode)) {
    throw new Error(`Duplicate opcode registered: ${def.opcode}`);
  }

  registry.set(def.opcode, def as MessageDef<unknown>);

  return def;
}

export function getMessageByOpcode(
  opcode: string
): MessageDef<unknown> | undefined {
  return registry.get(opcode);
}

export function listOpcodes(): string[] {
  return [...registry.keys()].sort();
}
