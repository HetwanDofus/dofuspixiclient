/**
 * Scene z-index layers.
 *
 * Per-cell sprites use multiplicative formulas so that higher cell IDs
 * (bottom of the map) draw on top. Top-level mapContainer children use
 * flat constants so the sortable mapContainer stacks them in the exact
 * order the original Dofus 1.29 client used (see ExternalContainer.as):
 *   Ground (200) → Object1 (300) → Grid (400) → Zone/cell-tints (500)
 *   → Object2 (800, sprites + foreground tiles) → fight fx
 *
 * Key invariants the port preserves:
 *   - cell tints render BELOW every sprite (fighter rings, placement
 *     cells, reachable range all sit on the floor);
 *   - damage text and spell anim containers render ABOVE sprites so
 *     floating numbers + crit bursts stay visible over fighters.
 */

/** Per-cell multiplier for object2 (foreground tiles above players' feet). */
export const Z_OBJECT2_LAYER = 100;

/** Added to `cellId * Z_OBJECT2_LAYER` so players interleave between object2 tiles. */
export const Z_PLAYER_OFFSET = 30;

/**
 * Top-level mapContainer layer zIndexes. mapContainer.sortableChildren
 * is true so children render in this order:
 *
 *   background  (Z_BACKGROUND_LAYER)
 *   ground      (Z_GROUND_LAYER)
 *   object1     (Z_OBJECT1_LAYER)
 *   cell tints  (Z_CELL_HIGHLIGHTER)   ← placement / range / path
 *   grid        (Z_GRID_OVERLAY)       ← just below obj2, above tints
 *   object2     (Z_OBJECT2_LAYER_ROOT) ← world actors + obj2 tiles
 *   fight fx    (Z_FIGHT_CONTAINER)    ← damage text + spell anims
 *   debug       (Z_DEBUG_OVERLAY)
 *
 * This mirrors the original Dofus 1.29 ExternalContainer depth layout
 * (Ground=200, Object1=300, Grid=400, Zone=500, Select=600, Pointer=700,
 * Object2=800, Accessories=900) adapted for our coarser set of layers.
 */
// Values mirror the original ExternalContainer.as depths scaled into
// our layer stack: Grid (400) < Zone/cell-tints (500) < Object2 (600
// → sprites) < fight-fx (700 → damage + spell animations).
export const Z_BACKGROUND_LAYER = 100;
export const Z_GROUND_LAYER = 200;
export const Z_OBJECT1_LAYER = 300;
export const Z_GRID_OVERLAY = 400;
export const Z_CELL_HIGHLIGHTER = 500;
/**
 * objectLayer2 container's zIndex inside mapContainer. Kept distinct
 * from `Z_OBJECT2_LAYER` (the per-cell tile multiplier used INSIDE
 * objectLayer2) to avoid confusion.
 */
export const Z_OBJECT2_LAYER_ROOT = 600;
export const Z_FIGHT_CONTAINER = 700;

/** Spell fx base (within fight-container). */
export const Z_SPELL_VIEW = 2000;

/** Damage text base (within fight-container). */
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
