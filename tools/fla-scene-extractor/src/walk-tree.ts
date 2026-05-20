import * as fs from "node:fs";
import * as path from "node:path";

import { parseSymbolFile, type ParsedSymbol } from "./parse-xml.ts";

export type SymbolLoader = (libraryItemName: string) => ParsedSymbol | undefined;

export function makeSymbolLoader(libraryDir: string): SymbolLoader {
  const cache = new Map<string, ParsedSymbol | undefined>();
  return (libraryItemName: string) => {
    if (cache.has(libraryItemName)) return cache.get(libraryItemName);
    const file = path.join(libraryDir, `${libraryItemName}.xml`);
    if (!fs.existsSync(file)) {
      cache.set(libraryItemName, undefined);
      return undefined;
    }
    const parsed = parseSymbolFile(file);
    cache.set(libraryItemName, parsed);
    return parsed;
  };
}

export function collectTransitiveSymbols(
  rootLibraryItemName: string,
  loader: SymbolLoader,
): Map<string, ParsedSymbol> {
  const out = new Map<string, ParsedSymbol>();
  const queue: string[] = [rootLibraryItemName];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (out.has(name)) continue;
    const sym = loader(name);
    if (!sym) continue;
    out.set(name, sym);
    for (const layer of sym.layers) {
      for (const el of layer.elements) {
        if (el.kind === "instance") {
          // libraryItemName references either an FLA library symbol OR an
          // AS3 linkage export class. The latter is resolved later via the
          // linkages map; we don't enqueue here unless the file exists.
          queue.push(el.libraryItemName);
        }
      }
    }
  }
  return out;
}
