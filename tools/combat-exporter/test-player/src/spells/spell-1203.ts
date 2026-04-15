/**
 * Spell 1203 - Panda Spell
 *
 * A projectile spell with two types of trailing particles.
 *
 * Components:
 * - shoot (sprite_8_shoot): Main animation at caster position, rotated toward target
 *   - Frame 4: _rotation = 0 (reset rotation)
 *   - Frame 39: child clip starts fading (_alpha -= 3.34 per frame)
 *   - Frame 72: stop() and removeMovieClip()
 * - DefineSprite_6 particles: Trailing particles with angular velocity
 * - DefineSprite_4 particles: Trailing particles with scale decay
 * - DefineSprite_9_move: Flicker effect with random alpha (50 + random(50))
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'm_panda_spell_a'
 * - Frame 4 (shoot): _rotation = 0
 * - Frame 72 (shoot): stop() → animation ends
 *
 * Hit signal: On frame 1 (instant hit, caster-targeted spell)
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1203 extends BaseSpell {
  readonly spellId = 1203;

  private shootAnim!: FrameAnimatedSprite;
  private particles6!: ASParticleSystem;
  private particles4!: ASParticleSystem;
  private level = 1;
  private initContext!: SpellInitContext;
  private frameCount = 0;
  private particleSpawnCounter = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.initContext = init;

    const angle = context?.angle ?? 0;

    // Main shoot animation at caster position, rotated toward target
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 1 (index 0): play sound
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('m_panda_spell_a');
      this.signalHit();
    });

    // Frame 4 (index 3): reset rotation of the shoot sprite
    this.shootAnim.onFrame(3, () => {
      this.shootAnim.sprite.rotation = 0;
    });

    // Frame 72 (index 71): stop
    this.shootAnim.stopAt(71);

    this.container.addChild(this.shootAnim.sprite);

    // Particle systems for DefineSprite_6 and DefineSprite_4
    // These are library symbols - use fallback textures if not available
    const tex6 = textures.hasTexture('lib_DefineSprite_6')
      ? textures.getFrames('lib_DefineSprite_6')[0]
      : textures.getFrames('shoot')[0];
    const tex4 = textures.hasTexture('lib_DefineSprite_4')
      ? textures.getFrames('lib_DefineSprite_4')[0]
      : textures.getFrames('shoot')[0];

    this.particles6 = new ASParticleSystem(tex6);
    this.particles6.container.position.set(0, init.casterY);
    this.container.addChildAt(this.particles6.container, 0);

    this.particles4 = new ASParticleSystem(tex4);
    this.particles4.container.position.set(0, init.casterY);
    this.container.addChildAt(this.particles4.container, 0);
  }

  private spawnParticle6(angleBase: number): void {
    // DefineSprite_6 frame_1/DoAction.as:
    // angle = _parent._parent.angle;
    // v = 0.67 + random(5);
    // va = 20 * (-0.5 + Math.random());
    // t = 100;
    // Physics per frame:
    //   if(random(5) == 0) { va = 20 * (-0.5 + Math.random()); }
    //   _xscale = v * 10;
    //   t *= 0.999;
    //   angle += va;
    //   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
    //   vy = v * Math.sin(angle * 0.017453292519943295);
    //   _X += vx; _Y += vy;
    //   v *= 0.95;
    //   _rotation = angle;
    // We approximate this with the particle system's linear physics.
    const v = 0.67 + Math.floor(Math.random() * 5);
    const va = 20 * (-0.5 + Math.random());
    const angleRad = angleBase * 0.017453292519943295;
    const vx = Math.abs(v * Math.cos(angleRad));
    const vy = v * Math.sin(angleRad);

    this.particles6.spawn({
      x: 0,
      y: 0,
      vx: vx,
      vy: vy,
      accX: 0.95,
      accY: 0.95,
      vr: va,
      vrDecay: 1.0,
      t: 100,
      vt: 0,
      vtDecay: 0,
      rotation: angleBase,
      alpha: 1,
    });
  }

  private spawnParticle4(angleBase: number): void {
    // DefineSprite_4 frame_1/DoAction.as:
    // angle = _parent._parent.angle;
    // v = 0.67 + random(5);
    // va = 20 * (-0.5 + Math.random());
    // t = 70 + random(30);
    // Physics per frame:
    //   if(random(3) == 1) { va = 20 * (-0.5 + Math.random()); }
    //   _xscale = t; _yscale = t;
    //   t *= 0.975;
    //   angle += va;
    //   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
    //   vy = v * Math.sin(angle * 0.017453292519943295);
    //   _X += vx; _Y += vy;
    //   v *= 0.95;
    const v = 0.67 + Math.floor(Math.random() * 5);
    const t = 70 + Math.floor(Math.random() * 30);
    const angleRad = angleBase * 0.017453292519943295;
    const vx = Math.abs(v * Math.cos(angleRad));
    const vy = v * Math.sin(angleRad);

    this.particles4.spawn({
      x: 0,
      y: 0,
      vx: vx,
      vy: vy,
      accX: 0.95,
      accY: 0.95,
      vr: 0,
      vrDecay: 1.0,
      t: t,
      vt: 0,
      vtDecay: t * (1 - 0.975), // approximate t *= 0.975 as vtDecay
      rotation: 0,
      alpha: 1,
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles6.update();
    this.particles4.update();

    // Spawn particles periodically while shoot animation plays (frames 1-38, before fade)
    const currentFrame = this.shootAnim.getFrame();
    if (currentFrame < 38) {
      this.particleSpawnCounter += deltaTime;
      // Spawn particles roughly every few frames
      while (this.particleSpawnCounter >= 16.67) {
        this.particleSpawnCounter -= 16.67;
        const angleDeg = (this.initContext.angleRad * 180) / Math.PI;
        this.spawnParticle6(angleDeg);
        this.spawnParticle4(angleDeg);
      }
    }

    if (this.shootAnim.isStopped() && !this.particles6.hasAliveParticles() && !this.particles4.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles6.destroy();
    this.particles4.destroy();
    super.destroy();
  }
}
