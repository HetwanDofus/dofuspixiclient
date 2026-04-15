/**
 * Parsed character look data.
 * Format: "gfx|color1|color2|color3|acc1,acc2,acc3,acc4,acc5"
 * Accessories: comma-separated "type_gfxId" entries.
 */
export interface ParsedLook {
  gfxId: number;
  color1: number;
  color2: number;
  color3: number;
  /** Accessory entries: [{type, gfxId}, ...] — 5 slots: weapon, hat, cape, pet, shield */
  accessories: AccessoryInfo[];
}

export interface AccessoryInfo {
  /** Item category (e.g., 16=hat, 6=sword) — first part of symbol name */
  type: number;
  /** GFX ID within that category — second part of symbol name */
  gfxId: number;
}

/**
 * Parse a look string into structured data.
 */
export function parseLook(look: string | undefined): ParsedLook {
  const result: ParsedLook = {
    gfxId: 0,
    color1: -1,
    color2: -1,
    color3: -1,
    accessories: [],
  };

  if (!look) {
    return result;
  }

  const parts = look.split("|");
  result.gfxId = parseInt(parts[0], 10) || 0;
  result.color1 = parts[1] != null ? parseInt(parts[1], 10) : -1;
  result.color2 = parts[2] != null ? parseInt(parts[2], 10) : -1;
  result.color3 = parts[3] != null ? parseInt(parts[3], 10) : -1;

  // Parse accessories (5th field, comma-separated)
  if (parts[4]) {
    const accParts = parts[4].split(",");

    for (const acc of accParts) {
      if (!acc) {
        result.accessories.push({ type: 0, gfxId: 0 });
        continue;
      }

      const [typeStr, gfxStr] = acc.split("_");
      result.accessories.push({
        type: parseInt(typeStr, 10) || 0,
        gfxId: parseInt(gfxStr, 10) || 0,
      });
    }
  }

  return result;
}

/**
 * Check if two accessory arrays are the same.
 */
export function accessoriesEqual(
  a: AccessoryInfo[],
  b: AccessoryInfo[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || a[i].gfxId !== b[i].gfxId) {
      return false;
    }
  }

  return true;
}
