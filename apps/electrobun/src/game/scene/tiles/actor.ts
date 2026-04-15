import type { AnimatedSprite, Container, Sprite } from "pixi.js";

import { Actor, type ActorId, freshActorId } from "../actor";
import {
  POSITIONED,
  type Positioned,
  RENDERED,
  type Rendered,
} from "../capabilities";

export interface TileActorInit {
  /** Pixi sprite owning the texture — Sprite extends Container, used as `container`. */
  sprite: Sprite | AnimatedSprite;
  /** AtlasLoader tileKey (e.g. "ground_123", "objects_45") — needed for zoom texture swap. */
  tileKey: string;
  /** Frame index within the atlas — needed for zoom texture swap. */
  frameIndex: number;
  /** True if this actor is backed by an AnimatedSprite (multi-frame). */
  isAnimated: boolean;
  /** Map cell this tile belongs to. */
  cellId: number;
  /** World-space position of the cell centre (after mapScale applied). */
  x: number;
  y: number;
  /** Layer index: 0=ground, 1=object1, 2=object2. Drives zIndex formula. */
  layer: number;
  /** Optional explicit zIndex override (otherwise derived from cellId + layer). */
  zIndex?: number;
}

/** layer → zIndex multiplier matches the hand-rolled formula in tile-layer-builder. */
function deriveZIndex(cellId: number, layer: number): number {
  return layer === 2 ? cellId * 100 : cellId;
}

/**
 * Scene actor for a single rendered tile.
 *
 * Wraps one Sprite or AnimatedSprite produced by the TileLayerBuilder with
 * Rendered + Positioned capabilities so the scene owns its lifecycle.
 *
 * Pixi's Sprite extends Container, so the sprite itself is the `container`
 * required by Rendered — no extra wrapper node needed.
 */
export class TileActor extends Actor implements Rendered, Positioned {
  readonly id: ActorId = freshActorId();
  readonly [RENDERED] = true as const;
  readonly [POSITIONED] = true as const;
  readonly container: Container;
  readonly zIndex: number;
  readonly tileKey: string;
  readonly isAnimated: boolean;

  cellId: number;
  x: number;
  y: number;
  frameIndex: number;

  constructor(init: TileActorInit) {
    super();
    this.container = init.sprite;
    this.tileKey = init.tileKey;
    this.frameIndex = init.frameIndex;
    this.isAnimated = init.isAnimated;
    this.cellId = init.cellId;
    this.x = init.x;
    this.y = init.y;
    this.zIndex = init.zIndex ?? deriveZIndex(init.cellId, init.layer);
  }

  /** Get the underlying sprite, typed. */
  getSprite(): Sprite | AnimatedSprite {
    return this.container as Sprite | AnimatedSprite;
  }

  /** Scene calls this on remove(id) / clear(). Idempotent. */
  dispose(): void {
    const sprite = this.container as Sprite | AnimatedSprite;

    if (sprite.destroyed) {
      return;
    }

    if (this.isAnimated && "stop" in sprite) {
      sprite.stop();
    }

    sprite.destroy();
  }
}
