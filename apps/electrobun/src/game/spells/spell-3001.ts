/**
 * Spell 3001 - Multi-element spell (Eniripsa)
 *
 * A stationary effect at the target position that spawns elemental particles
 * based on params (fire, water, earth, air).
 *
 * Components:
 * - sprite_4: Large rotating element sprite at target, stops at frame 60
 * - sprite_12: Small element sprite at target, stops at frame 30
 * - sprite_15: Medium element sprite at target, stops at frame 30
 * - sprite_26: Horizontal element sprite at target, stops at frame 39
 * - sprite_29: Particle container at target, stops at frame 38
 *   - Spawns part_f particles if params.fire == 1
 *   - Spawns part_w particles if params.water == 1
 *   - Spawns part_e particles if params.earth == 1
 *   - Spawns part_a particles if params.air == 1
 *
 * Original AS timing:
 * - Frame 1 (sprite_4): random rotation/scale/pos, gotoAndPlay(random(15)+1), vr decay
 * - Frame 1 (sprite_12): random rotation/pos, gotoAndPlay(random(10)+1)
 * - Frame 1 (sprite_15): random rotation/scale/pos, gotoAndPlay(random(10)+1)
 * - Frame 1 (sprite_26): random rotation/scale/pos, gotoAndPlay(random(5)+1)
 * - Frame 1 (sprite_29): onClipEvent(load) spawns elemental particles
 * - Frame 39 (sprite_29): removeMovieClip()
 * - Frame 61 (sprite_4): stop()
 * - Frame 31 (sprite_12): stop()
 * - Frame 31 (sprite_15): stop()
 * - Frame 40 (sprite_26): stop()
 * - Frame 2 (main): stop() — main timeline stops, spell plays out
 * - Hit: signaled at start (instant spell)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container, Sprite, Texture } from "pixi.js";

const SPRITE4_MANIFEST: SpriteManifest = {
  width: 78.3,
  height: 101,
  offsetX: -41.15,
  offsetY: -94.25,
};

const SPRITE12_MANIFEST: SpriteManifest = {
  width: 37.2,
  height: 66.85,
  offsetX: -11,
  offsetY: -62.55,
};

const SPRITE15_MANIFEST: SpriteManifest = {
  width: 102.25,
  height: 121.35,
  offsetX: -16.8,
  offsetY: -87.3,
};

const SPRITE26_MANIFEST: SpriteManifest = {
  width: 108.45,
  height: 18.75,
  offsetX: -110.35,
  offsetY: -18.3,
};

// Library symbol manifests for particles
const PART_F_MANIFEST: SpriteManifest = {
  width: 29.35,
  height: 27.6,
  offsetX: -4.5,
  offsetY: -18,
};

const PART_W_MANIFEST: SpriteManifest = {
  width: 49.75,
  height: 48.4,
  offsetX: -14,
  offsetY: -35.05,
};

const PART_E_MANIFEST: SpriteManifest = {
  width: 61.75,
  height: 60.6,
  offsetX: -16.3,
  offsetY: -25.95,
};

const PART_A_MANIFEST: SpriteManifest = {
  width: 32.2,
  height: 37.45,
  offsetX: -29,
  offsetY: -37.45,
};

interface ElementParticle {
  sprite: Sprite;
  rotation: number;
  vr: number;
}

export class Spell3001 extends BaseSpell {
  readonly spellId = 3001;

  private sprite4Anim!: FrameAnimatedSprite;
  private sprite12Anim!: FrameAnimatedSprite;
  private sprite15Anim!: FrameAnimatedSprite;
  private sprite26Anim!: FrameAnimatedSprite;
  private sprite29Anim!: FrameAnimatedSprite;

  // Particles for sprite_4's rotation decay
  private sprite4Vr = 0;

  // Elemental particle sprites (from sprite_29's onClipEvent(load))
  private elementParticles: ElementParticle[] = [];
  private particleContainer!: Container;
  private sprite29Stopped = false;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const targetX = init.targetX;
    const targetY = init.targetY;

    // --- sprite_4 ---
    // AS frame_1: random rotation, scale 20-80%, random offset ±10px, gotoAndPlay(random(15)+1), vr = random(10)
    {
      const startFrame4 = Math.floor(Math.random() * 15); // random(15) -> 0-indexed: 0-14 -> gotoAndPlay(1..15) = frame index 0..14
      const anchor4 = calculateAnchor(SPRITE4_MANIFEST);
      this.sprite4Anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_4"),
          fps: 60,
          startFrame: startFrame4,
          anchorX: anchor4.x,
          anchorY: anchor4.y,
          scale: init.scale,
        })
      );

      // AS: _rotation = random(360)
      const rotation4 = Math.floor(Math.random() * 360);
      // AS: t = 20 + 60 * Math.random()
      const t4 = 20 + 60 * Math.random();
      // AS: _xscale = t; _yscale = t (percentage → scale)
      const scale4 = (t4 / 100) * init.scale;
      // AS: _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5)
      const x4 = targetX + 20 * (Math.random() - 0.5) * init.scale;
      const y4 = targetY + 20 * (Math.random() - 0.5) * init.scale;

      this.sprite4Anim.sprite.rotation = (rotation4 * Math.PI) / 180;
      this.sprite4Anim.sprite.scale.set(scale4);
      this.sprite4Anim.sprite.position.set(x4, y4);

      // AS: vr = random(10)
      this.sprite4Vr = Math.floor(Math.random() * 10);

      // AS frame_61: stop() → 0-indexed: stopAt(60)
      this.sprite4Anim.stopAt(60);

      this.container.addChild(this.sprite4Anim.sprite);
    }

    // --- sprite_12 ---
    // AS frame_1: random rotation, random offset ±10px, gotoAndPlay(random(10)+1)
    // No scale randomization for sprite_12
    {
      const startFrame12 = Math.floor(Math.random() * 10); // random(10) -> 0..9
      const anchor12 = calculateAnchor(SPRITE12_MANIFEST);
      this.sprite12Anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_12"),
          fps: 60,
          startFrame: startFrame12,
          anchorX: anchor12.x,
          anchorY: anchor12.y,
          scale: init.scale,
        })
      );

      // AS: _rotation = random(360)
      const rotation12 = Math.floor(Math.random() * 360);
      // AS: _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5)
      const x12 = targetX + 20 * (Math.random() - 0.5) * init.scale;
      const y12 = targetY + 20 * (Math.random() - 0.5) * init.scale;

      this.sprite12Anim.sprite.rotation = (rotation12 * Math.PI) / 180;
      this.sprite12Anim.sprite.position.set(x12, y12);

      // AS frame_31: stop() → 0-indexed: stopAt(30)
      this.sprite12Anim.stopAt(30);

      this.container.addChild(this.sprite12Anim.sprite);
    }

    // --- sprite_15 ---
    // AS frame_1: random rotation, scale 0-60%, random offset ±10px, gotoAndPlay(random(10)+1)
    {
      const startFrame15 = Math.floor(Math.random() * 10); // random(10) -> 0..9
      const anchor15 = calculateAnchor(SPRITE15_MANIFEST);
      this.sprite15Anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_15"),
          fps: 60,
          startFrame: startFrame15,
          anchorX: anchor15.x,
          anchorY: anchor15.y,
          scale: init.scale,
        })
      );

      // AS: _rotation = random(360)
      const rotation15 = Math.floor(Math.random() * 360);
      // AS: t = 60 * Math.random()
      const t15 = 60 * Math.random();
      const scale15 = (t15 / 100) * init.scale;
      // AS: _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5)
      const x15 = targetX + 20 * (Math.random() - 0.5) * init.scale;
      const y15 = targetY + 20 * (Math.random() - 0.5) * init.scale;

      this.sprite15Anim.sprite.rotation = (rotation15 * Math.PI) / 180;
      this.sprite15Anim.sprite.scale.set(scale15);
      this.sprite15Anim.sprite.position.set(x15, y15);

      // AS frame_31: stop() → 0-indexed: stopAt(30)
      this.sprite15Anim.stopAt(30);

      this.container.addChild(this.sprite15Anim.sprite);
    }

    // --- sprite_26 ---
    // AS frame_1: random rotation, scale 0-60%, random offset ±10px, gotoAndPlay(random(5)+1)
    {
      const startFrame26 = Math.floor(Math.random() * 5); // random(5) -> 0..4
      const anchor26 = calculateAnchor(SPRITE26_MANIFEST);
      this.sprite26Anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_26"),
          fps: 60,
          startFrame: startFrame26,
          anchorX: anchor26.x,
          anchorY: anchor26.y,
          scale: init.scale,
        })
      );

      // AS: _rotation = random(360)
      const rotation26 = Math.floor(Math.random() * 360);
      // AS: t = 60 * Math.random()
      const t26 = 60 * Math.random();
      const scale26 = (t26 / 100) * init.scale;
      // AS: _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5)
      const x26 = targetX + 20 * (Math.random() - 0.5) * init.scale;
      const y26 = targetY + 20 * (Math.random() - 0.5) * init.scale;

      this.sprite26Anim.sprite.rotation = (rotation26 * Math.PI) / 180;
      this.sprite26Anim.sprite.scale.set(scale26);
      this.sprite26Anim.sprite.position.set(x26, y26);

      // AS frame_40: stop() → 0-indexed: stopAt(39)
      this.sprite26Anim.stopAt(39);

      this.container.addChild(this.sprite26Anim.sprite);
    }

    // --- sprite_29 (particle container) ---
    // offsetY = -17, so position it at targetX, targetY - 17*scale
    {
      const startFrame29 = 0;
      this.sprite29Anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("sprite_29"),
          fps: 60,
          startFrame: startFrame29,
        })
      );
      // sprite_29 has zero width/height in manifest, it's a container
      // AS offsetY = -17 for the sprite_29
      this.sprite29Anim.sprite.position.set(targetX, targetY - 17 * init.scale);

      // AS frame_39: removeMovieClip() → 0-indexed: frame 38
      this.sprite29Anim.stopAt(38);
      this.sprite29Anim.onFrame(38, () => {
        this.sprite29Stopped = true;
      });

      // sprite_29's sprite itself is invisible (it's just a container in AS)
      // We hide it since we render particles ourselves
      this.sprite29Anim.sprite.visible = false;
      this.container.addChild(this.sprite29Anim.sprite);
    }

    // --- Elemental particles (from sprite_29's onClipEvent(load)) ---
    // AS:
    //   c2 = 100;
    //   n = 14 - 3*fire - 3*water - 3*earth - 3*air
    //   for each active element: spawn n particles
    {
      this.particleContainer = new Container();
      this.particleContainer.position.set(targetX, targetY - 17 * init.scale);
      this.container.addChild(this.particleContainer);

      const params = context?.params ?? {
        fire: false,
        water: false,
        earth: false,
        air: false,
      };
      const fireBit = params.fire ? 1 : 0;
      const waterBit = params.water ? 1 : 0;
      const earthBit = params.earth ? 1 : 0;
      const airBit = params.air ? 1 : 0;

      const n = 14 - 3 * fireBit - 3 * waterBit - 3 * earthBit - 3 * airBit;

      if (params.fire) {
        const partFTexture = textures.hasTexture("lib_part_f_0")
          ? textures.getTexture("lib_part_f_0")
          : (textures.getFrames("lib_part_f")[0] ?? Texture.EMPTY);
        const anchor = calculateAnchor(PART_F_MANIFEST);
        for (let i = 0; i < n; i++) {
          const sprite = new Sprite(partFTexture);
          sprite.anchor.set(anchor.x, anchor.y);
          sprite.scale.set(init.scale);
          // Each part_f is its own DefineSprite_26 instance:
          // _rotation = random(360), _X/Y = 20*(rand-0.5), t=60*rand, gotoAndPlay(random(5)+1)
          const rot = Math.floor(Math.random() * 360);
          sprite.rotation = (rot * Math.PI) / 180;
          sprite.x = 20 * (Math.random() - 0.5) * init.scale;
          sprite.y = 20 * (Math.random() - 0.5) * init.scale;
          const t = 60 * Math.random();
          const sc = (t / 100) * init.scale;
          sprite.scale.set(sc);
          this.particleContainer.addChild(sprite);
          // vr for part_f (DefineSprite_26) does not have vr in its AS (unlike sprite_4)
          this.elementParticles.push({ sprite, rotation: rot, vr: 0 });
        }
      }

      if (params.water) {
        const partWTexture = textures.hasTexture("lib_part_w_0")
          ? textures.getTexture("lib_part_w_0")
          : (textures.getFrames("lib_part_w")[0] ?? Texture.EMPTY);
        const anchor = calculateAnchor(PART_W_MANIFEST);
        for (let i = 0; i < n; i++) {
          const sprite = new Sprite(partWTexture);
          sprite.anchor.set(anchor.x, anchor.y);
          const rot = Math.floor(Math.random() * 360);
          sprite.rotation = (rot * Math.PI) / 180;
          sprite.x = 20 * (Math.random() - 0.5) * init.scale;
          sprite.y = 20 * (Math.random() - 0.5) * init.scale;
          const t = 60 * Math.random();
          const sc = (t / 100) * init.scale;
          sprite.scale.set(sc);
          this.particleContainer.addChild(sprite);
          this.elementParticles.push({ sprite, rotation: rot, vr: 0 });
        }
      }

      if (params.earth) {
        const partETexture = textures.hasTexture("lib_part_e_0")
          ? textures.getTexture("lib_part_e_0")
          : (textures.getFrames("lib_part_e")[0] ?? Texture.EMPTY);
        const anchor = calculateAnchor(PART_E_MANIFEST);
        for (let i = 0; i < n; i++) {
          const sprite = new Sprite(partETexture);
          sprite.anchor.set(anchor.x, anchor.y);
          const rot = Math.floor(Math.random() * 360);
          sprite.rotation = (rot * Math.PI) / 180;
          sprite.x = 20 * (Math.random() - 0.5) * init.scale;
          sprite.y = 20 * (Math.random() - 0.5) * init.scale;
          const t = 60 * Math.random();
          const sc = (t / 100) * init.scale;
          sprite.scale.set(sc);
          this.particleContainer.addChild(sprite);
          this.elementParticles.push({ sprite, rotation: rot, vr: 0 });
        }
      }

      if (params.air) {
        const partATexture = textures.hasTexture("lib_part_a_0")
          ? textures.getTexture("lib_part_a_0")
          : (textures.getFrames("lib_part_a")[0] ?? Texture.EMPTY);
        const anchor = calculateAnchor(PART_A_MANIFEST);
        for (let i = 0; i < n; i++) {
          const sprite = new Sprite(partATexture);
          sprite.anchor.set(anchor.x, anchor.y);
          const rot = Math.floor(Math.random() * 360);
          sprite.rotation = (rot * Math.PI) / 180;
          sprite.x = 20 * (Math.random() - 0.5) * init.scale;
          sprite.y = 20 * (Math.random() - 0.5) * init.scale;
          const t = 60 * Math.random();
          const sc = (t / 100) * init.scale;
          sprite.scale.set(sc);
          this.particleContainer.addChild(sprite);
          this.elementParticles.push({ sprite, rotation: rot, vr: 0 });
        }
      }
    }

    // Hit is signaled immediately (instant spell at target)
    this.signalHit();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update sprite_4's rotation decay: _rotation += (vr *= 0.9)
    // AS: this.onEnterFrame = function() { _rotation = _rotation + (vr *= 0.9); }
    // We apply this per-frame in the update; deltaTime is in ms, we simulate per-frame at 60fps
    const frameDelta = deltaTime / (1000 / 60);
    this.sprite4Vr *= 0.9 ** frameDelta;
    const rotDeg = (this.sprite4Anim.sprite.rotation * 180) / Math.PI;
    const newRotDeg = rotDeg + this.sprite4Vr * frameDelta;
    this.sprite4Anim.sprite.rotation = (newRotDeg * Math.PI) / 180;

    // Hide particle container when sprite_29 stops
    if (this.sprite29Stopped) {
      this.particleContainer.visible = false;
    }

    if (this.anims.allStopped()) {
      this.complete();
    }
  }

  destroy(): void {
    for (const p of this.elementParticles) {
      p.sprite.destroy();
    }
    this.elementParticles = [];
    if (this.particleContainer) {
      this.particleContainer.destroy({ children: false });
    }
    super.destroy();
  }
}
