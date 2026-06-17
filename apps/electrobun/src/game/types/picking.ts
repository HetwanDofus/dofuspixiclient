import type { Container, Sprite, TextureSource } from "pixi.js";

export interface PickableBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Cached alpha map accessor passed into a `PickableObject.alphaTest`.
 * Pickers can call `get(source)` to fetch the cached alpha bitmap
 * for any uploaded `TextureSource` (class atlas pages, accessory
 * strips, tile sources, ...). Returns null while extraction is
 * pending or has failed — caller decides AABB vs miss policy.
 */
export interface AlphaMapAccessor {
  get(source: TextureSource): {
    data: Uint8Array;
    width: number;
    height: number;
  } | null;
}

export interface PickableObject {
  id: number;
  /**
   * The rasterised sprite tested by `PickingSystem.pick`'s AABB +
   * alpha pass. Optional because a crowd pickable (`crowd: true`)
   * carries no baked strip sprite — it's resolved by the crowd
   * hit-test (`crowdResolver`) keyed on `playerId`, not by a
   * sprite-local AABB.
   */
  sprite?: Sprite;
  bounds?: PickableBounds;
  parentContainer?: Container;
  /**
   * Marks a crowd-managed pickable. The picker skips it in the
   * sprite-AABB loop and instead resolves it via the registered
   * crowd hit-test, gated by `parentContainer.zIndex` against the
   * sprite candidates.
   */
  crowd?: boolean;
  /** Player id this crowd pickable resolves to (crowd pickables only). */
  playerId?: number;
  /**
   * Optional pixel-test override. Called by `PickingSystem.pick`
   * after the AABB pass has placed the hover point inside
   * `sprite.texture.frame`. `adjX, adjY` are the point's coords in
   * frame pixels — i.e. local-point + anchor × frame.size, ready to
   * compare against `frame.width × frame.height`.
   *
   * Returning `true` accepts the hit; `false` rejects (no further
   * sprite-side alpha lookup happens). When omitted, picking falls
   * back to the legacy single-source alpha extraction.
   *
   * Renderers use this for multi-band silhouettes (class atlas
   * variants laid out as N stacked band strips) or for picking
   * surfaces whose live texture isn't extractable (`RenderTexture`
   * sources — Pixi v8 doesn't expose their GPUTexture via
   * `.resource`).
   */
  alphaTest?: (adjX: number, adjY: number, alphas: AlphaMapAccessor) => boolean;
}

export interface PickResult {
  object: PickableObject;
  x: number;
  y: number;
}
