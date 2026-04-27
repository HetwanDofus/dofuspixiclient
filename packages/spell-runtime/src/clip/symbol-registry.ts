/**
 * SymbolRegistry — per-spell library symbol lookup.
 *
 * Mirrors the Flash "library" concept: each SWF carries a set of
 * named symbols (`baton`, `baton2`, `effet`, `cercle`, `move`,
 * `shoot`, …) which AS scripts spawn at runtime via
 * `attachMovie(name, instanceName, depth)`. We model this as a plain
 * `Map<string, SymbolDefinition>` registered before the spell starts
 * and consulted by `SpellClip.attach`.
 *
 * The registry is per-spell so the same symbol name can mean different
 * things in different spells (e.g. `baton` in spell 103 is a thorn,
 * `baton` in some other spell is a magic stick).
 */

import type { SymbolDefinition } from "./types.ts";

export class SymbolRegistry {
  private readonly symbols = new Map<string, SymbolDefinition>();

  register(symbol: SymbolDefinition): void {
    this.symbols.set(symbol.name, symbol);
  }

  resolve(name: string): SymbolDefinition | undefined {
    return this.symbols.get(name);
  }

  has(name: string): boolean {
    return this.symbols.has(name);
  }

  /** Iterate every registered symbol — used by the runtime at init time. */
  all(): IterableIterator<SymbolDefinition> {
    return this.symbols.values();
  }
}
