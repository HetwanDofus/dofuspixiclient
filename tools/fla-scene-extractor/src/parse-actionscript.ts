import type { SymbolInstanceProps } from "./types.ts";

// FLA <Actionscript><script> blocks on DOMSymbolInstance carry the AS3
// constructor properties that the original client read at runtime
// (e.g. styleName, text, backgroundUp/Down, enabled). Format is always:
//   on(construct){
//      key1 = value;
//      key2 = "string value";
//      ...
//   }
// Values are quoted strings, bare numbers, or booleans. Unknown keys are
// preserved as strings so downstream consumers can opt into them without
// requiring schema bumps.

const ON_CONSTRUCT = /on\s*\(\s*construct\s*\)\s*\{([\s\S]*?)\}/m;
const ASSIGNMENT = /^\s*([A-Za-z_$][\w$]*)\s*=\s*(.+?);\s*$/gm;

export function parseActionscriptConstruct(
  script: string | undefined,
): SymbolInstanceProps | undefined {
  if (!script) return undefined;

  const block = ON_CONSTRUCT.exec(script);
  if (!block) return undefined;

  const body = block[1];
  const props: Record<string, string | number | boolean> = {};

  // Reset regex state (global flag).
  ASSIGNMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASSIGNMENT.exec(body)) !== null) {
    const key = match[1];
    const rawValue = match[2].trim();
    const parsed = parseValue(rawValue);
    if (parsed !== undefined) props[key] = parsed;
  }

  return Object.keys(props).length > 0 ? (props as SymbolInstanceProps) : undefined;
}

function parseValue(raw: string): string | number | boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;

  if (raw.startsWith('"') && raw.endsWith('"')) {
    return unescapeAs3String(raw.slice(1, -1));
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return unescapeAs3String(raw.slice(1, -1));
  }

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  // Bare identifiers (e.g. null, undefined) or unknown shape — keep as-is.
  return raw;
}

function unescapeAs3String(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}
