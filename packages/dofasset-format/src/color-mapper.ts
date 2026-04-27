import type {
  Color,
  ColorZone,
  CompiledAsset,
  SpriteMetadata,
} from "./types.js";
import { TintMode } from "./types.js";

/**
 * Normalize hex color to lowercase 6-char format.
 */
function normHex(hex: string): string {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  return `#${h}`;
}

function colorToHex(c: Color): string {
  const r = c.r.toString(16).padStart(2, "0");
  const g = c.g.toString(16).padStart(2, "0");
  const b = c.b.toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

/**
 * Apply color zone information from metadata.json to draw commands.
 * Tags each fill draw command with its zone ID if its color matches a zone.
 *
 * @param tintMode stored per zone so the runtime knows how to compose the
 *   player_colors array (Player = 3-slot body/trim/accent, Guild = 2-slot
 *   background/foreground, Spell = 1-slot, AlignmentLevel = 1-slot ramp).
 */
export function applyColorZones(
  asset: CompiledAsset,
  metadata: SpriteMetadata | null,
  tintMode: TintMode = TintMode.Player,
): void {
  if (!metadata) return;

  const { colorZones: zoneColors, colorMapping } = metadata;

  // Build lookup: normalized hex → zone id
  const colorToZone = new Map<string, number>();
  const zones: ColorZone[] = [];

  // Sort zone keys to match Pixi's processing order (first zone claims shared colors).
  const sortedEntries = Object.entries(zoneColors).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  for (const [zoneName, colors] of sortedEntries) {
    const playerColorIdx = colorMapping[zoneName];
    if (playerColorIdx === undefined) continue;

    const zoneId = parseInt(zoneName, 10);
    const zoneOriginalColors: Color[] = [];

    for (const hex of colors) {
      const nh = normHex(hex);
      if (!colorToZone.has(nh)) {
        colorToZone.set(nh, zoneId);
      }
      const r = parseInt(nh.slice(1, 3), 16);
      const g = parseInt(nh.slice(3, 5), 16);
      const b = parseInt(nh.slice(5, 7), 16);
      zoneOriginalColors.push({ r, g, b, a: 255 });
    }

    zones.push({
      zoneId,
      playerColorIndex: playerColorIdx,
      tintMode,
      originalColors: zoneOriginalColors,
    });
  }

  asset.colorZones = zones;

  // Tag draw commands
  for (const cmd of asset.drawCommands) {
    if (cmd.type === 0 || cmd.type === 1) {
      const hex = colorToHex(cmd.color);
      const zoneId = colorToZone.get(normHex(hex));
      if (zoneId !== undefined) {
        cmd.colorZoneId = zoneId;
      }
    }
  }
}
