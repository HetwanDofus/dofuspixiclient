import type { MountDisplay } from "@dofus/proto";
import { type Container, Sprite } from "pixi.js";

import {
  type CharacterAnimation,
  type CharacterSpriteLoader,
  isDirectionFlipped,
} from "@/game/assets/character-sprite";

/**
 * Mount layer offset to avoid collision with regular sprite IDs in the
 * character sprite loader. Chevauchor (rider) assets live at gfxId +
 * CHEVAUCHOR_ID_OFFSET.
 */
const CHEVAUCHOR_ID_OFFSET = 1_000_000;

/**
 * Z-indexes inside the player container for mount layering:
 *   -1: mount _Back (saddle/tail — behind rider)
 *    0: chevauchor / rider
 *    1: mount _Front (head/neck — in front of rider)
 * The player's main sprite is repurposed as _Back.
 */
const Z_BACK = -1;
const Z_CHEVAUCHOR = 0;
const Z_FRONT = 1;

/**
 * Chevauchor anchor Y (saddle vertical offset relative to mount anchor).
 * Extracted from _mcChevauchorPos in the legacy mount SVGs; ~-23 to -25 units.
 */
const CHEVAUCHOR_ANCHOR_Y = -24;

const ANIM_PREFIX_RE = /^(static|walk|run|anim\d+|hit|die|bonus|appear)/;

/**
 * Manages the three mount-related sprites for a single mounted player:
 *   - _Back layer (repurposes the main sprite, so we only track its anim)
 *   - _Front layer (own Sprite child)
 *   - Chevauchor / rider (own Sprite child)
 *
 * The caller drives frame sync via `syncFrame(frameIndex)` each tick.
 */
export class PlayerMountLayers {
  mountFrontSprite?: Sprite;
  mountFrontAnim: CharacterAnimation | null = null;
  chevauchorSprite?: Sprite;
  chevauchorAnim: CharacterAnimation | null = null;

  constructor(
    private readonly container: Container,
    private readonly spriteLoader: CharacterSpriteLoader,
    private readonly stillValid: (forAnimName: string) => boolean,
    private readonly getCurrentDirection: () => number
  ) {}

  /**
   * Load + position all mount layers for the given base anim.
   * The caller's main sprite is repurposed as _Back; we replace its texture +
   * offsets and notify via `onBackAnimLoaded` so the caller can cache the
   * animation data (used by the tick loop to sync frame textures).
   */
  apply(
    mainSprite: Sprite,
    gfxId: number,
    look: string,
    animName: string,
    flipped: boolean,
    mount: MountDisplay | undefined,
    onBackAnimLoaded: (anim: CharacterAnimation) => void
  ): void {
    this.applyBack(
      mainSprite,
      gfxId,
      look,
      animName,
      flipped,
      onBackAnimLoaded
    );
    this.applyFront(gfxId, look, animName, flipped);

    if (mount) {
      this.applyChevauchor(mount, animName, flipped);
    }
  }

  /**
   * Flip all mount layers in place (sprite textures unchanged, just direction).
   */
  updateFlip(flipped: boolean): void {
    if (this.mountFrontSprite && this.mountFrontAnim) {
      this.mountFrontSprite.scale.x = flipped ? -1 : 1;
      this.mountFrontSprite.x = flipped
        ? -this.mountFrontAnim.offsetX
        : this.mountFrontAnim.offsetX;
    }

    if (this.chevauchorSprite && this.chevauchorAnim) {
      this.chevauchorSprite.scale.x = flipped ? -1 : 1;
      this.chevauchorSprite.x = flipped
        ? -this.chevauchorAnim.offsetX
        : this.chevauchorAnim.offsetX;
    }
  }

  /** Update each mount layer sprite to show the given frame index. */
  syncFrame(frameIndex: number): void {
    if (this.mountFrontSprite?.visible && this.mountFrontAnim) {
      const a = this.mountFrontAnim;
      const count = a.frameCount ?? a.textures.length;
      this.mountFrontSprite.texture = a.textures[frameIndex % count];
    }

    if (this.chevauchorSprite?.visible && this.chevauchorAnim) {
      const a = this.chevauchorAnim;
      const count = a.frameCount ?? a.textures.length;
      this.chevauchorSprite.texture = a.textures[frameIndex % count];
    }
  }

  /** Repurpose the main sprite as _Back. */
  private applyBack(
    mainSprite: Sprite,
    gfxId: number,
    look: string,
    animName: string,
    flipped: boolean,
    onBackAnimLoaded: (anim: CharacterAnimation) => void
  ): void {
    mainSprite.zIndex = Z_BACK;
    mainSprite.visible = false;

    const backAnimName = `${animName}_Back`;
    const cached = this.spriteLoader.getAnimationSync(
      gfxId,
      backAnimName,
      look
    );

    if (cached) {
      onBackAnimLoaded(cached);
      mainSprite.visible = true;
      positionSprite(mainSprite, cached, flipped);
      return;
    }

    void this.spriteLoader
      .loadAnimation(gfxId, backAnimName, look)
      .then((anim) => {
        if (!this.stillValid(animName) || !anim) {
          return;
        }

        onBackAnimLoaded(anim);
        mainSprite.visible = true;
        positionSprite(
          mainSprite,
          anim,
          isDirectionFlipped(this.getCurrentDirection())
        );
      });
  }

  private applyFront(
    gfxId: number,
    look: string,
    animName: string,
    flipped: boolean
  ): void {
    this.loadAndAttach({
      gfxId,
      look,
      animName,
      fullAnimName: `${animName}_Front`,
      zIndex: Z_FRONT,
      extraY: 0,
      flipped,
      getSprite: () => this.mountFrontSprite,
      setSprite: (s) => {
        this.mountFrontSprite = s;
      },
      setAnim: (a) => {
        this.mountFrontAnim = a;
      },
    });
  }

  private applyChevauchor(
    mount: MountDisplay,
    animName: string,
    flipped: boolean
  ): void {
    const chevGfxId = CHEVAUCHOR_ID_OFFSET + mount.gfxId;
    const suffix = animName.replace(ANIM_PREFIX_RE, "");
    const chevAnimName = `static${suffix}`;

    this.loadAndAttach({
      gfxId: chevGfxId,
      look: undefined,
      animName,
      fullAnimName: chevAnimName,
      zIndex: Z_CHEVAUCHOR,
      extraY: CHEVAUCHOR_ANCHOR_Y,
      flipped,
      getSprite: () => this.chevauchorSprite,
      setSprite: (s) => {
        this.chevauchorSprite = s;
      },
      setAnim: (a) => {
        this.chevauchorAnim = a;
      },
    });
  }

  private loadAndAttach(opts: {
    gfxId: number;
    look: string | undefined;
    animName: string;
    fullAnimName: string;
    zIndex: number;
    extraY: number;
    flipped: boolean;
    getSprite: () => Sprite | undefined;
    setSprite: (s: Sprite) => void;
    setAnim: (a: CharacterAnimation | null) => void;
  }): void {
    // Hide current instance while the new layer loads so stale frames don't flash.
    const existing = opts.getSprite();

    if (existing) {
      existing.visible = false;
    }

    const cached = this.spriteLoader.getAnimationSync(
      opts.gfxId,
      opts.fullAnimName,
      opts.look
    );

    if (cached) {
      this.attachOrUpdate(opts, cached, opts.flipped);
      return;
    }

    void this.spriteLoader
      .loadAnimation(opts.gfxId, opts.fullAnimName, opts.look)
      .then((anim) => {
        if (!this.stillValid(opts.animName)) {
          return;
        }

        if (!anim) {
          opts.setAnim(null);
          return;
        }

        this.attachOrUpdate(
          opts,
          anim,
          isDirectionFlipped(this.getCurrentDirection())
        );
      });
  }

  private attachOrUpdate(
    opts: {
      zIndex: number;
      extraY: number;
      getSprite: () => Sprite | undefined;
      setSprite: (s: Sprite) => void;
      setAnim: (a: CharacterAnimation | null) => void;
    },
    anim: CharacterAnimation,
    flipped: boolean
  ): void {
    opts.setAnim(anim);

    let sprite = opts.getSprite();

    if (!sprite) {
      sprite = new Sprite(anim.textures[0]);
      sprite.anchor.set(0, 0);
      sprite.zIndex = opts.zIndex;
      this.container.addChild(sprite);
      opts.setSprite(sprite);
    }

    sprite.visible = true;
    positionSprite(sprite, anim, flipped, opts.extraY);
  }
}

function positionSprite(
  sprite: Sprite,
  anim: CharacterAnimation,
  flipped: boolean,
  extraY = 0
): void {
  sprite.texture = anim.textures[0];
  sprite.scale.x = flipped ? -1 : 1;
  sprite.x = flipped ? -anim.offsetX : anim.offsetX;
  sprite.y = anim.offsetY + extraY;
}
