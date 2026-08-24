import type { CSSProperties } from "react";

interface ItemIconProps {
  /** `ItemTemplateData.typeId` — the first path segment. */
  typeId: number;
  /** `ItemTemplateData.gfxId` — the second path segment. */
  gfxId: number;
  /** A base-unit pixel size, or a CSS size string (e.g. `"100%"`). */
  size: number | string;
  alt?: string;
  style?: CSSProperties;
}

/**
 * Renders an item's icon from `/assets/items/<typeId>/<gfxId>.svg` — a
 * plain `<img>`, not the Vello/WASM canvas spell icons use. Item icons
 * were never migrated off SVG (`tools/asset-pipeline`'s publish stage
 * comment says as much), and there are 11 398 of them already published
 * under that exact path, verified against the imported `item_templates`.
 */
export function ItemIcon({ typeId, gfxId, size, alt, style }: ItemIconProps) {
  return (
    <img
      src={`/assets/items/${typeId}/${gfxId}.svg`}
      alt={alt ?? ""}
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        ...style,
      }}
      // A template with no published icon (17 of 11 415, per the import
      // audit) fails silently rather than showing a broken-image glyph.
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
