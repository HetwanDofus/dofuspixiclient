/**
 * Scene z-index layers.
 *
 * Per-cell sprites use multiplicative formulas (Z_GROUND_LAYER, Z_OBJECT2_LAYER)
 * so that higher cell IDs (bottom of the map) draw on top. Overlay Actors use
 * flat constants that live above all per-cell content.
 *
 * Ordering (low → high):
 *   ground/object1 (cellId)
 *   object2        (cellId * 100)
 *   players       (cellId * 100 + Z_PLAYER_OFFSET)
 *   cell highlight (Z_CELL_HIGHLIGHTER)
 *   grid overlay   (Z_GRID_OVERLAY)
 *   spell fx       (Z_SPELL_VIEW)
 *   damage text    (Z_DAMAGE_VIEW + index)
 *   debug overlay  (Z_DEBUG_OVERLAY)
 *   ghost view     (+ Z_GHOST_VIEW_OFFSET to any of the above)
 */

/** Per-cell multiplier for object2 (foreground tiles above players' feet). */
export const Z_OBJECT2_LAYER = 100;

/** Added to `cellId * Z_OBJECT2_LAYER` so players interleave between object2 tiles. */
export const Z_PLAYER_OFFSET = 30;

export const Z_CELL_HIGHLIGHTER = 4000;
export const Z_GRID_OVERLAY = 5000;

/** Spell fx base; instances add no offset (multi-cast use independent containers). */
export const Z_SPELL_VIEW = 2000;

/** Damage text base; each spawn adds an increasing sub-index to stack vertically. */
export const Z_DAMAGE_VIEW = 1000;

export const Z_DEBUG_OVERLAY = 10000;

/** Lifts ghost-mode players above all normal scene content for turn preview. */
export const Z_GHOST_VIEW_OFFSET = 100000;

/** Player z-index formula: `cellId * Z_OBJECT2_LAYER + Z_PLAYER_OFFSET`. */
export function playerZIndex(cellId: number, ghost = false): number {
  return (
    cellId * Z_OBJECT2_LAYER +
    Z_PLAYER_OFFSET +
    (ghost ? Z_GHOST_VIEW_OFFSET : 0)
  );
}

/** Tile z-index formula: object2 → `cellId * Z_OBJECT2_LAYER`; else `cellId`. */
export function tileZIndex(cellId: number, layer: number): number {
  return layer === 2 ? cellId * Z_OBJECT2_LAYER : cellId;
}
