/**
 * Spell 2049 - Herbe/Jet
 *
 * A projectile spell that travels from caster to target, then spawns bubble particles.
 *
 * Components:
 * - sprite_9: Beam/projectile at caster position, rotated toward target, stops at frame 24
 * - sprite_10: Main timeline container at caster position, stops at frame 45
 * - sprite_11: Impact animation at target position, spawns bubbles at frame 69, signals hit
 * - sprite_4: Additional element, stops at frame 51
 * - bulle particles: 6 bubble particles spawned at frame 69 of sprite_11
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_10): Play sound 'herbe', set position/angle
 * - Frame 2 (main): Play sound 'jet_903', stop
 * - Frame 1 (DefineSprite_11): Set position to target, set rotation
 * - Frame 25 (DefineSprite_9): stop()
 * - Frame 46 (DefineSprite_10): stop()
 * - Frame 52 (DefineSprite_4): stop()
 * - Frame 70 (DefineSprite_11): Play 'coquille', spawn 6 bubbles, signal hit (this.end())
 * - Frame 133 (DefineSprite_11): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  ASParticleSystem,
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

const SPRITE_9_MANIFEST: SpriteManifest = {
  width: 215.4,
  height: 37.85,
  offsetX: -47.2,
  offsetY: -19.15,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 215.4,
  height: 86.6,
  offsetX: -48.2,
  offsetY: -74.15,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 238.3,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

export class Spell2049 extends BaseSpell {
  readonly spellId = 2049;

  private sprite11Anim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private particlesContainer!: Container;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Calculate angle the same way AS does:
    // dx = cellTo.x - cellFrom.x
    // dy = cellTo.y + 10 - cellFrom.y + 25
    // angle = Math.atan2(dy, dx) * 180 / 3.1415
    const dx = (context?.cellTo?.x ?? 0) - (context?.cellFrom?.x ?? 0);
    const dy =
      (context?.cellTo?.y ?? 0) + 10 - (context?.cellFrom?.y ?? 0) + 25;
    const angleRad = Math.atan2(dy, dx);

    // sprite_10 is the outer container at caster position
    // It contains sprite_9 (beam) which is rotated by angle
    // sprite_10 stops at frame 45 (AS frame 46)
    const sprite10Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_10"),
        ...calculateAnchor(SPRITE_10_MANIFEST),
        scale: init.scale,
      })
    );
    sprite10Anim.sprite.position.set(0, init.casterY);
    sprite10Anim.sprite.rotation = angleRad;
    sprite10Anim.stopAt(45).onFrame(0, () => this.callbacks.playSound("herbe"));
    this.container.addChild(sprite10Anim.sprite);

    // sprite_9 is placed inside sprite_10 context but we render it at caster position too
    // In AS: placed at frame 46 of sprite_10 with _rotation = _parent.angle
    // sprite_9 stops at frame 24 (AS frame 25)
    const sprite9Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_9"),
        ...calculateAnchor(SPRITE_9_MANIFEST),
        scale: init.scale,
      })
    );
    sprite9Anim.sprite.position.set(0, init.casterY);
    sprite9Anim.sprite.rotation = angleRad;
    sprite9Anim.stopAt(24);
    this.container.addChild(sprite9Anim.sprite);

    // sprite_4 at caster position, stops at frame 51 (AS frame 52)
    const sprite4Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_4"),
        ...calculateAnchor(SPRITE_4_MANIFEST),
        scale: init.scale,
      })
    );
    sprite4Anim.sprite.position.set(0, init.casterY);
    sprite4Anim.sprite.rotation = angleRad;
    sprite4Anim.stopAt(51);
    this.container.addChild(sprite4Anim.sprite);

    // sprite_11 is at target position, rotated by angle
    // Frame 1 (AS): _X = cellTo.x, _Y = cellTo.y - 10, _rotation = angle
    // In our coordinate system (relative to cellFrom), target is at targetX, targetY
    // But AS sets absolute position: cellTo.x, cellTo.y - 10
    // We need to offset: cellTo.y - 10 vs our caster Y.
    // Since our container is at cellFrom, target offset is:
    // x = cellTo.x - cellFrom.x = targetX (init already computed this)
    // y = cellTo.y - 10 - cellFrom.y = (cellTo.y - cellFrom.y) - 10
    const targetRelY =
      (context?.cellTo?.y ?? 0) - (context?.cellFrom?.y ?? 0) - 10;

    this.sprite11Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_11"),
        ...calculateAnchor(SPRITE_11_MANIFEST),
        scale: init.scale,
      })
    );
    this.sprite11Anim.sprite.position.set(init.targetX, targetRelY);
    this.sprite11Anim.sprite.rotation = angleRad;
    this.sprite11Anim
      .onFrame(69, () => this.onSprite11Frame70())
      .onFrame(132, () => this.complete());
    this.container.addChild(this.sprite11Anim.sprite);

    // Particle container at target position for bubbles
    this.particlesContainer = new Container();
    this.particlesContainer.position.set(init.targetX, targetRelY);
    this.container.addChild(this.particlesContainer);

    // Bubble particle system
    const bulleTexture = textures.getFrames("lib_bulle")[0];
    this.particles = new ASParticleSystem(bulleTexture);
    this.particles.container.position.set(0, 0);
    this.particlesContainer.addChild(this.particles.container);

    // Main timeline frame 2 (0-indexed: 1): play 'jet_903'
    // We simulate this by playing sound at the start (the main timeline stops at frame 2)
    this.callbacks.playSound("jet_903");
  }

  private onSprite11Frame70(): void {
    // AS frame 70: playSound, spawn 6 bubbles, this.end()
    this.callbacks.playSound("coquille");
    this.spawnBubbles();
    this.signalHit();
  }

  private spawnBubbles(): void {
    // AS: c = 1; while(c < 7) { attachMovie("bulle","bulle"+c,c); c++; }
    // That spawns 6 bubbles (c = 1,2,3,4,5,6)
    //
    // Each bulle has onClipEvent(load): gotoAndPlay(random(15) + 1)
    // And frame_1 DoAction:
    //   rx = 0.7 + 0.15 * Math.random()
    //   ry = 0.8 + 0.15 * Math.random()
    //   vx = 20 + random(25)
    //   vy = -15 + random(30)
    //   _alpha = random(50) + 50
    //   onEnterFrame: _X += (vx *= rx); _Y += (vy *= ry)

    this.particles.spawnMany(6, () => {
      const rx = 0.7 + 0.15 * Math.random();
      const ry = 0.8 + 0.15 * Math.random();
      const vx = 20 + Math.floor(Math.random() * 25);
      const vy = -15 + Math.floor(Math.random() * 30);
      const alpha = (Math.floor(Math.random() * 50) + 50) / 100;

      // In AS particle physics terms:
      // _X += (vx *= rx)  => accX = rx, initial vx = vx
      // _Y += (vy *= ry)  => accY = ry, initial vy = vy
      // No rotation, scale stays constant (t=100, vt=0)
      return {
        x: 0,
        y: 0,
        vx,
        vy,
        accX: rx,
        accY: ry,
        vr: 0,
        vrDecay: 1,
        t: 100,
        vt: 0,
        vtDecay: 0,
        alpha,
        alphaVelocity: 0,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // Completion is triggered at sprite_11 frame 132 (AS frame 133: removeMovieClip)
    // which calls this.complete() via the onFrame callback
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
