/**
 * Spell 1056 - (Wabbit/CC spell)
 *
 * A complex multi-phase spell with several sprite animations.
 *
 * Components:
 * - sprite_67: At target, plays sound 'death' at frame 1 (idx 0), stops at frame 10 (idx 9)
 * - sprite_61: At target, plays sound 'death' at frame 1 (idx 0), stops at frame 9 (idx 8)
 * - sprite_43: At target, stops at frame 9 (idx 8)
 * - sprite_55: At target, stops at frame 9 (idx 8)
 * - sprite_19: At target, stops at frame 14 (idx 13)
 * - sprite_34: At target, signals end at frame 24 (idx 23), alpha flicker from frame 9 (idx 8)
 * - sprite_35: At target, signals end at frame 24 (idx 23), alpha flicker from frame 9 (idx 8)
 * - sprite_27: At target, plays sound 'cc_wabbit' at frame 8 (idx 7), signals end at frame 9 (idx 8)
 * - sprite_30: At target, plays sound 'cc_wabbit' at frame 8 (idx 7), signals end at frame 9 (idx 8)
 * - sprite_48: At target, plays sound 'hit_defaut' at frame 3 (idx 2)
 * - sprite_51: At target, plays sound 'hit_defaut' at frame 3 (idx 2)
 * - sprite_21: At target, plays through 13 frames
 * - sprite_22: At target, plays through 13 frames
 * - sprite_23: At target, plays through 10 frames
 * - sprite_24: At target, plays through 10 frames
 * - sprite_56: At target, plays through 13 frames
 * - sprite_57: At target, plays through 13 frames
 *
 * Original AS timing:
 * - Frame 1 (main): var apparition = 1
 * - Frame 15 (main): apparition = 0 (PlaceObject2_21_1 load)
 * - Frame 23 (main): apparition = 0 (PlaceObject2_22_1 load)
 * - Frame 31 (main): PlaceObject2_12_1 load -> GAC.applyAnim(Appear) if apparition==1
 * - Frame 37 (main): PlaceObject2_16_1 load -> GAC.applyAnim(Appear) if apparition==1
 *
 * Sounds from manifest:
 * - Frame 0 (0-indexed): 'death'
 * - Frame 2 (0-indexed): 'hit_defaut'
 * - Frame 7 (0-indexed): 'cc_wabbit'
 *
 * Key events:
 * - DefineSprite_27/frame_9: GAC.applyEnd -> signalHit
 * - DefineSprite_30/frame_9: GAC.applyEnd -> signalHit
 * - DefineSprite_34/frame_24: GAC.applyEnd -> signalHit
 * - DefineSprite_35/frame_24: GAC.applyEnd -> signalHit
 * - DefineSprite_34/frame_9 & DefineSprite_35/frame_9: enterFrame alpha flicker (_alpha = random(100))
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_19_MANIFEST: SpriteManifest = {
  width: 23.3,
  height: 35.5,
  offsetX: -11.45,
  offsetY: -18.3,
};

const SPRITE_21_MANIFEST: SpriteManifest = {
  width: 33.5,
  height: 47.9,
  offsetX: -17.6,
  offsetY: -41.95,
};

const SPRITE_22_MANIFEST: SpriteManifest = {
  width: 33.5,
  height: 44.9,
  offsetX: -15,
  offsetY: -38.75,
};

const SPRITE_23_MANIFEST: SpriteManifest = {
  width: 36.1,
  height: 55.65,
  offsetX: -18.95,
  offsetY: -46,
};

const SPRITE_24_MANIFEST: SpriteManifest = {
  width: 35.05,
  height: 53.3,
  offsetX: -16.75,
  offsetY: -43.35,
};

const SPRITE_27_MANIFEST: SpriteManifest = {
  width: 45.9,
  height: 51.35,
  offsetX: -28.25,
  offsetY: -44.4,
};

const SPRITE_30_MANIFEST: SpriteManifest = {
  width: 48.35,
  height: 49.6,
  offsetX: -19.35,
  offsetY: -43.85,
};

const SPRITE_34_MANIFEST: SpriteManifest = {
  width: 41.35,
  height: 133.95,
  offsetX: -23.35,
  offsetY: -117.95,
};

const SPRITE_35_MANIFEST: SpriteManifest = {
  width: 40.1,
  height: 125.8,
  offsetX: -16.65,
  offsetY: -118.5,
};

const SPRITE_43_MANIFEST: SpriteManifest = {
  width: 52.2,
  height: 33.55,
  offsetX: -25.85,
  offsetY: -17.15,
};

const SPRITE_48_MANIFEST: SpriteManifest = {
  width: 71.05,
  height: 75.75,
  offsetX: -52.25,
  offsetY: -71.45,
};

const SPRITE_51_MANIFEST: SpriteManifest = {
  width: 85.45,
  height: 75.55,
  offsetX: -64.75,
  offsetY: -71.45,
};

const SPRITE_55_MANIFEST: SpriteManifest = {
  width: 57.6,
  height: 40.1,
  offsetX: -28.55,
  offsetY: -20.35,
};

const SPRITE_56_MANIFEST: SpriteManifest = {
  width: 72.55,
  height: 64.75,
  offsetX: -56.35,
  offsetY: -58.6,
};

const SPRITE_57_MANIFEST: SpriteManifest = {
  width: 71.55,
  height: 64.55,
  offsetX: -56.35,
  offsetY: -58.6,
};

const SPRITE_61_MANIFEST: SpriteManifest = {
  width: 67.15,
  height: 83.4,
  offsetX: -33.9,
  offsetY: -69.95,
};

const SPRITE_67_MANIFEST: SpriteManifest = {
  width: 38.15,
  height: 87.05,
  offsetX: -19.1,
  offsetY: -69.1,
};

export class Spell1056 extends BaseSpell {
  readonly spellId = 1056;

  // Flickering sprites that need alpha updates each frame
  private sprite34Anim!: FrameAnimatedSprite;
  private sprite35Anim!: FrameAnimatedSprite;
  private sprite34Flickering = false;
  private sprite35Flickering = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const tx = init.targetX;
    const ty = init.targetY;
    const sc = init.scale;

    // --- sprite_67: plays sound 'death' at frame 0, stops at frame 9 ---
    if (textures.hasTexture("sprite_67_0")) {
      const anchor67 = calculateAnchor(SPRITE_67_MANIFEST);
      const anim67 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_67"),
          fps: 25,
          anchorX: anchor67.x,
          anchorY: anchor67.y,
          scale: sc,
        })
      );
      anim67.sprite.position.set(tx, ty);
      anim67.stopAt(9).onFrame(0, () => this.callbacks.playSound("death"));
      this.container.addChild(anim67.sprite);
    }

    // --- sprite_61: plays sound 'death' at frame 0, stops at frame 8 ---
    if (textures.hasTexture("sprite_61_0")) {
      const anchor61 = calculateAnchor(SPRITE_61_MANIFEST);
      const anim61 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_61"),
          fps: 25,
          anchorX: anchor61.x,
          anchorY: anchor61.y,
          scale: sc,
        })
      );
      anim61.sprite.position.set(tx, ty);
      anim61.stopAt(8).onFrame(0, () => this.callbacks.playSound("death"));
      this.container.addChild(anim61.sprite);
    }

    // --- sprite_43: stops at frame 8 ---
    if (textures.hasTexture("sprite_43_0")) {
      const anchor43 = calculateAnchor(SPRITE_43_MANIFEST);
      const anim43 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_43"),
          fps: 25,
          anchorX: anchor43.x,
          anchorY: anchor43.y,
          scale: sc,
        })
      );
      anim43.sprite.position.set(tx, ty);
      anim43.stopAt(8);
      this.container.addChild(anim43.sprite);
    }

    // --- sprite_55: stops at frame 8 ---
    if (textures.hasTexture("sprite_55_0")) {
      const anchor55 = calculateAnchor(SPRITE_55_MANIFEST);
      const anim55 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_55"),
          fps: 25,
          anchorX: anchor55.x,
          anchorY: anchor55.y,
          scale: sc,
        })
      );
      anim55.sprite.position.set(tx, ty);
      anim55.stopAt(8);
      this.container.addChild(anim55.sprite);
    }

    // --- sprite_19: stops at frame 13 ---
    if (textures.hasTexture("sprite_19_0")) {
      const anchor19 = calculateAnchor(SPRITE_19_MANIFEST);
      const anim19 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_19"),
          fps: 25,
          anchorX: anchor19.x,
          anchorY: anchor19.y,
          scale: sc,
        })
      );
      anim19.sprite.position.set(tx, ty);
      anim19.stopAt(13);
      this.container.addChild(anim19.sprite);
    }

    // --- sprite_48: plays sound 'hit_defaut' at frame 2 (AS frame 3, 0-indexed) ---
    if (textures.hasTexture("sprite_48_0")) {
      const anchor48 = calculateAnchor(SPRITE_48_MANIFEST);
      const anim48 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_48"),
          fps: 25,
          anchorX: anchor48.x,
          anchorY: anchor48.y,
          scale: sc,
        })
      );
      anim48.sprite.position.set(tx, ty);
      anim48.onFrame(2, () => this.callbacks.playSound("hit_defaut"));
      this.container.addChild(anim48.sprite);
    }

    // --- sprite_51: plays sound 'hit_defaut' at frame 2 (AS frame 3, 0-indexed) ---
    if (textures.hasTexture("sprite_51_0")) {
      const anchor51 = calculateAnchor(SPRITE_51_MANIFEST);
      const anim51 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_51"),
          fps: 25,
          anchorX: anchor51.x,
          anchorY: anchor51.y,
          scale: sc,
        })
      );
      anim51.sprite.position.set(tx, ty);
      anim51.onFrame(2, () => this.callbacks.playSound("hit_defaut"));
      this.container.addChild(anim51.sprite);
    }

    // --- sprite_21: plays through 13 frames ---
    if (textures.hasTexture("sprite_21_0")) {
      const anchor21 = calculateAnchor(SPRITE_21_MANIFEST);
      const anim21 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_21"),
          fps: 25,
          anchorX: anchor21.x,
          anchorY: anchor21.y,
          scale: sc,
        })
      );
      anim21.sprite.position.set(tx, ty);
      this.container.addChild(anim21.sprite);
    }

    // --- sprite_22: plays through 13 frames ---
    if (textures.hasTexture("sprite_22_0")) {
      const anchor22 = calculateAnchor(SPRITE_22_MANIFEST);
      const anim22 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_22"),
          fps: 25,
          anchorX: anchor22.x,
          anchorY: anchor22.y,
          scale: sc,
        })
      );
      anim22.sprite.position.set(tx, ty);
      this.container.addChild(anim22.sprite);
    }

    // --- sprite_23: plays through 10 frames ---
    if (textures.hasTexture("sprite_23_0")) {
      const anchor23 = calculateAnchor(SPRITE_23_MANIFEST);
      const anim23 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_23"),
          fps: 25,
          anchorX: anchor23.x,
          anchorY: anchor23.y,
          scale: sc,
        })
      );
      anim23.sprite.position.set(tx, ty);
      this.container.addChild(anim23.sprite);
    }

    // --- sprite_24: plays through 10 frames ---
    if (textures.hasTexture("sprite_24_0")) {
      const anchor24 = calculateAnchor(SPRITE_24_MANIFEST);
      const anim24 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_24"),
          fps: 25,
          anchorX: anchor24.x,
          anchorY: anchor24.y,
          scale: sc,
        })
      );
      anim24.sprite.position.set(tx, ty);
      this.container.addChild(anim24.sprite);
    }

    // --- sprite_56: plays through 13 frames ---
    if (textures.hasTexture("sprite_56_0")) {
      const anchor56 = calculateAnchor(SPRITE_56_MANIFEST);
      const anim56 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_56"),
          fps: 25,
          anchorX: anchor56.x,
          anchorY: anchor56.y,
          scale: sc,
        })
      );
      anim56.sprite.position.set(tx, ty);
      this.container.addChild(anim56.sprite);
    }

    // --- sprite_57: plays through 13 frames ---
    if (textures.hasTexture("sprite_57_0")) {
      const anchor57 = calculateAnchor(SPRITE_57_MANIFEST);
      const anim57 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_57"),
          fps: 25,
          anchorX: anchor57.x,
          anchorY: anchor57.y,
          scale: sc,
        })
      );
      anim57.sprite.position.set(tx, ty);
      this.container.addChild(anim57.sprite);
    }

    // --- sprite_27: sound 'cc_wabbit' at frame 7 (AS frame 8), GAC.applyEnd at frame 8 (AS frame 9) ---
    if (textures.hasTexture("sprite_27_0")) {
      const anchor27 = calculateAnchor(SPRITE_27_MANIFEST);
      const anim27 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_27"),
          fps: 25,
          anchorX: anchor27.x,
          anchorY: anchor27.y,
          scale: sc,
        })
      );
      anim27.sprite.position.set(tx, ty);
      anim27
        .onFrame(7, () => this.callbacks.playSound("cc_wabbit"))
        .onFrame(8, () => this.signalHit());
      this.container.addChild(anim27.sprite);
    }

    // --- sprite_30: sound 'cc_wabbit' at frame 7 (AS frame 8), GAC.applyEnd at frame 8 (AS frame 9) ---
    if (textures.hasTexture("sprite_30_0")) {
      const anchor30 = calculateAnchor(SPRITE_30_MANIFEST);
      const anim30 = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_30"),
          fps: 25,
          anchorX: anchor30.x,
          anchorY: anchor30.y,
          scale: sc,
        })
      );
      anim30.sprite.position.set(tx, ty);
      anim30
        .onFrame(7, () => this.callbacks.playSound("cc_wabbit"))
        .onFrame(8, () => this.signalHit());
      this.container.addChild(anim30.sprite);
    }

    // --- sprite_34: alpha flicker from frame 8 (AS frame 9), GAC.applyEnd at frame 23 (AS frame 24) ---
    if (textures.hasTexture("sprite_34_0")) {
      const anchor34 = calculateAnchor(SPRITE_34_MANIFEST);
      this.sprite34Anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_34"),
          fps: 25,
          anchorX: anchor34.x,
          anchorY: anchor34.y,
          scale: sc,
        })
      );
      this.sprite34Anim.sprite.position.set(tx, ty);
      this.sprite34Anim
        .onFrame(
          8,
          () => {
            this.sprite34Flickering = true;
          },
          false
        )
        .onFrame(23, () => this.signalHit());
      this.container.addChild(this.sprite34Anim.sprite);
    }

    // --- sprite_35: alpha flicker from frame 8 (AS frame 9), GAC.applyEnd at frame 23 (AS frame 24) ---
    if (textures.hasTexture("sprite_35_0")) {
      const anchor35 = calculateAnchor(SPRITE_35_MANIFEST);
      this.sprite35Anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_35"),
          fps: 25,
          anchorX: anchor35.x,
          anchorY: anchor35.y,
          scale: sc,
        })
      );
      this.sprite35Anim.sprite.position.set(tx, ty);
      this.sprite35Anim
        .onFrame(
          8,
          () => {
            this.sprite35Flickering = true;
          },
          false
        )
        .onFrame(23, () => this.signalHit());
      this.container.addChild(this.sprite35Anim.sprite);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply alpha flicker for sprite_34 (AS: _alpha = random(100))
    if (
      this.sprite34Anim &&
      this.sprite34Flickering &&
      !this.sprite34Anim.isComplete()
    ) {
      this.sprite34Anim.sprite.alpha = Math.floor(Math.random() * 100) / 100;
    }

    // Apply alpha flicker for sprite_35 (AS: _alpha = random(100))
    if (
      this.sprite35Anim &&
      this.sprite35Flickering &&
      !this.sprite35Anim.isComplete()
    ) {
      this.sprite35Anim.sprite.alpha = Math.floor(Math.random() * 100) / 100;
    }

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
