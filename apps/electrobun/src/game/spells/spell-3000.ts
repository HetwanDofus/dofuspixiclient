/**
 * Spell 3000 - Multi-element spell (Turquoise Dofus / Soft Oak / etc.)
 *
 * A multi-element effect that shows particle sprites based on params (fire, water, earth, air).
 * Each element spawns its own set of particle instances.
 *
 * Components:
 * - sprite_4 (fire): Rotating looping particles at target, stops at frame 60
 * - sprite_12 (water): Simple particles at target, stops at frame 30
 * - sprite_15 (earth): Simple particles at target, stops at frame 30
 * - sprite_26 (air): Simple particles at target, stops at frame 39
 * - sprite_29: Container/coordinator that removes itself at frame 57
 *
 * Original AS timing:
 * - sprite_4 frame_1: random rotation, scale, position, start frame (random(15)+1), rotation decay
 * - sprite_12 frame_1: random rotation, position, start frame (random(10)+1)
 * - sprite_12 frame_31: stop()
 * - sprite_15 frame_1: random rotation, scale, position, start frame (random(10)+1)
 * - sprite_15 frame_31: stop()
 * - sprite_26 frame_1: random rotation, scale, position, start frame (random(5)+1)
 * - sprite_26 frame_40: stop()
 * - sprite_4 frame_61: stop()
 * - sprite_29 frame_58: removeMovieClip / animation ends
 *
 * The sprite_29 onClipEvent(load) spawns:
 *   n = 14 - 3*fire - 3*water - 3*earth - 3*air particles per active element
 *   Each active element gets n particle instances
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 78.3,
  height: 101,
  offsetX: -41.15,
  offsetY: -94.25,
};

const SPRITE_12_MANIFEST: SpriteManifest = {
  width: 37.2,
  height: 66.85,
  offsetX: -11,
  offsetY: -62.55,
};

const SPRITE_15_MANIFEST: SpriteManifest = {
  width: 102.25,
  height: 121.35,
  offsetX: -16.8,
  offsetY: -87.3,
};

const SPRITE_26_MANIFEST: SpriteManifest = {
  width: 108.45,
  height: 18.75,
  offsetX: -110.35,
  offsetY: -18.3,
};

interface ParticleAnimState {
  anim: FrameAnimatedSprite;
  vr: number;
  useRotationDecay: boolean;
}

export class Spell3000 extends BaseSpell {
  readonly spellId = 3000;

  private particleStates: ParticleAnimState[] = [];
  private effectContainer!: Container;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const params = context?.params ?? {
      fire: false,
      water: false,
      earth: false,
      air: false,
    };

    const fireFl = params.fire ? 1 : 0;
    const waterFl = params.water ? 1 : 0;
    const earthFl = params.earth ? 1 : 0;
    const airFl = params.air ? 1 : 0;

    // n = 14 - 3*fire - 3*water - 3*earth - 3*air
    const n = 14 - 3 * fireFl - 3 * waterFl - 3 * earthFl - 3 * airFl;

    // Container at target position (sprite_29 position offset by offsetY = -17)
    this.effectContainer = new Container();
    this.effectContainer.position.set(
      init.targetX,
      init.targetY - 17 * init.scale
    );
    this.container.addChild(this.effectContainer);

    // Fire particles (part_f -> sprite_4 logic)
    if (params.fire) {
      const fireTextures = textures.getFrames("sprite_4");
      const anchor = calculateAnchor(SPRITE_4_MANIFEST);

      for (let i = 0; i < n; i++) {
        // AS: _rotation = random(360)
        const rotation = Math.floor(Math.random() * 360);
        // AS: t = 20 + 60 * Math.random()
        const t = 20 + 60 * Math.random();
        // AS: _X = 20 * (Math.random() - 0.5), _Y = 20 * (Math.random() - 0.5)
        const x = 20 * (Math.random() - 0.5);
        const y = 20 * (Math.random() - 0.5);
        // AS: gotoAndPlay(random(15) + 1) -> 0-indexed: random(15)
        const startFrame = Math.floor(Math.random() * 15);
        // AS: vr = random(10)
        const vr = Math.floor(Math.random() * 10);

        const anim = this.anims.add(
          new FrameAnimatedSprite({
            textures: fireTextures,
            anchorX: anchor.x,
            anchorY: anchor.y,
            scale: init.scale,
            startFrame,
          })
        );
        anim.sprite.rotation = (rotation * Math.PI) / 180;
        anim.sprite.scale.set((t / 100) * init.scale);
        anim.sprite.position.set(x * init.scale, y * init.scale);
        anim.stopAt(60);
        this.effectContainer.addChild(anim.sprite);

        this.particleStates.push({ anim, vr, useRotationDecay: true });
      }
    }

    // Water particles (part_w -> sprite_12 logic)
    if (params.water) {
      const waterTextures = textures.getFrames("sprite_12");
      const anchor = calculateAnchor(SPRITE_12_MANIFEST);

      for (let i = 0; i < n; i++) {
        // AS: _rotation = random(360)
        const rotation = Math.floor(Math.random() * 360);
        // AS: _X = 20 * (Math.random() - 0.5), _Y = 20 * (Math.random() - 0.5)
        const x = 20 * (Math.random() - 0.5);
        const y = 20 * (Math.random() - 0.5);
        // AS: gotoAndPlay(random(10) + 1) -> 0-indexed: random(10)
        const startFrame = Math.floor(Math.random() * 10);

        const anim = this.anims.add(
          new FrameAnimatedSprite({
            textures: waterTextures,
            anchorX: anchor.x,
            anchorY: anchor.y,
            scale: init.scale,
            startFrame,
          })
        );
        anim.sprite.rotation = (rotation * Math.PI) / 180;
        anim.sprite.position.set(x * init.scale, y * init.scale);
        anim.stopAt(30);
        this.effectContainer.addChild(anim.sprite);

        this.particleStates.push({ anim, vr: 0, useRotationDecay: false });
      }
    }

    // Earth particles (part_e -> sprite_15 logic)
    if (params.earth) {
      const earthTextures = textures.getFrames("sprite_15");
      const anchor = calculateAnchor(SPRITE_15_MANIFEST);

      for (let i = 0; i < n; i++) {
        // AS: _rotation = random(360)
        const rotation = Math.floor(Math.random() * 360);
        // AS: _X = 20 * (Math.random() - 0.5), _Y = 20 * (Math.random() - 0.5)
        const x = 20 * (Math.random() - 0.5);
        const y = 20 * (Math.random() - 0.5);
        // AS: t = 60 * Math.random()
        const t = 60 * Math.random();
        // AS: gotoAndPlay(random(10) + 1) -> 0-indexed: random(10)
        const startFrame = Math.floor(Math.random() * 10);

        const anim = this.anims.add(
          new FrameAnimatedSprite({
            textures: earthTextures,
            anchorX: anchor.x,
            anchorY: anchor.y,
            scale: init.scale,
            startFrame,
          })
        );
        anim.sprite.rotation = (rotation * Math.PI) / 180;
        anim.sprite.scale.set((t / 100) * init.scale);
        anim.sprite.position.set(x * init.scale, y * init.scale);
        anim.stopAt(30);
        this.effectContainer.addChild(anim.sprite);

        this.particleStates.push({ anim, vr: 0, useRotationDecay: false });
      }
    }

    // Air particles (part_a -> sprite_26 logic)
    if (params.air) {
      const airTextures = textures.getFrames("sprite_26");
      const anchor = calculateAnchor(SPRITE_26_MANIFEST);

      for (let i = 0; i < n; i++) {
        // AS: _rotation = random(360)
        const rotation = Math.floor(Math.random() * 360);
        // AS: _X = 20 * (Math.random() - 0.5), _Y = 20 * (Math.random() - 0.5)
        const x = 20 * (Math.random() - 0.5);
        const y = 20 * (Math.random() - 0.5);
        // AS: t = 60 * Math.random()
        const t = 60 * Math.random();
        // AS: gotoAndPlay(random(5) + 1) -> 0-indexed: random(5)
        const startFrame = Math.floor(Math.random() * 5);

        const anim = this.anims.add(
          new FrameAnimatedSprite({
            textures: airTextures,
            anchorX: anchor.x,
            anchorY: anchor.y,
            scale: init.scale,
            startFrame,
          })
        );
        anim.sprite.rotation = (rotation * Math.PI) / 180;
        anim.sprite.scale.set((t / 100) * init.scale);
        anim.sprite.position.set(x * init.scale, y * init.scale);
        anim.stopAt(39);
        this.effectContainer.addChild(anim.sprite);

        this.particleStates.push({ anim, vr: 0, useRotationDecay: false });
      }
    }

    // Signal hit immediately (no explicit hit frame in AS - the effect is the hit)
    this.signalHit();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Apply rotation decay for fire particles (sprite_4 onEnterFrame)
    // AS: _rotation = _rotation + (vr *= 0.9)
    for (const state of this.particleStates) {
      if (state.useRotationDecay && state.vr !== 0) {
        state.vr *= 0.9;
        state.anim.sprite.rotation += (state.vr * Math.PI) / 180;
      }
    }

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
