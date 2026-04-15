/**
 * Spell 316 - Pépite (Nugget/Gold Dust)
 *
 * A particle shower spell that spawns up to 119 "pepite" (nugget) particles
 * falling from above the target position with gravity physics.
 *
 * Components:
 * - Up to 119 pepite particles spawned one per frame starting from frame 1
 * - Each particle falls with gravity, bounces, and stops
 * - Main container fades out starting at frame 127 (-5 alpha per frame)
 * - Removes at frame 160
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_8): Begin spawning pepites, one per enterFrame, up to c=119
 * - Frame 127 (DefineSprite_8): Container starts fading (_alpha -= 5 per frame)
 * - Frame 160 (DefineSprite_8): removeMovieClip(), stop()
 *
 * Pepite physics (DefineSprite_5_pepite/frame_1):
 * - _rotation = random(360)
 * - _Y = -90 (start above)
 * - g = 0.6 (gravity)
 * - v = 0 (vertical velocity)
 * - h = _parent.h (floor height, starts at -10, increments by 0.5 each spawn)
 * - amp = 60 - h
 * - dh = random(5)
 * - _X = amp * (-0.5 + Math.random())
 * - t = 30 + 70 * Math.random() (scale %)
 * - vx = -0.5 + Math.random()
 * - Each frame: _X += vx; _Y += (v += g)
 * - When _Y > -h: bounce with reduced velocity, stop horizontal, reduce dh
 *
 * Pepite sprite (PlaceObject2_3_1 onClipEvent load):
 * - gotoAndStop(random(2) + 1) -> start at frame 0 or 1 (0-indexed)
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const PEPITE_MANIFEST: SpriteManifest = {
  width: 13.3,
  height: 17.8,
  offsetX: -6.55,
  offsetY: -12.25,
};

interface PepiteParticle {
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  h: number;
  dh: number;
  stopped: boolean;
}

export class Spell316 extends BaseSpell {
  readonly spellId = 316;

  private pepiteTextures: Texture[] = [];
  private pepiteAnchorX = 0.5;
  private pepiteAnchorY = 0.5;
  private pepiteScale = 1;

  private pepiteContainer!: Container;
  private particles: PepiteParticle[] = [];
  private spawnCount = 1; // c starts at 1
  private h = -10; // h starts at -10

  private frameAccumulator = 0;
  private readonly frameTime = 1000 / 60;
  private currentFrame = 0;
  private containerAlpha = 1;
  private fadingOut = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    this.pepiteTextures = textures.getFrames('lib_pepite');
    const anchor = calculateAnchor(PEPITE_MANIFEST);
    this.pepiteAnchorX = anchor.x;
    this.pepiteAnchorY = anchor.y;
    this.pepiteScale = init.scale;

    // Main container positioned at target
    this.pepiteContainer = new Container();
    this.pepiteContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pepiteContainer);
  }

  private spawnPepite(): void {
    if (this.pepiteTextures.length === 0) {
      return;
    }

    // PlaceObject2_3_1 onClipEvent(load): gotoAndStop(random(2) + 1) -> frame 0 or 1 (0-indexed)
    const startFrame = Math.floor(Math.random() * 2);

    const anim = new FrameAnimatedSprite({
      textures: this.pepiteTextures,
      anchorX: this.pepiteAnchorX,
      anchorY: this.pepiteAnchorY,
      scale: this.pepiteScale,
      startFrame,
    });
    // pepite starts stopped at the random frame (gotoAndStop)
    anim.pause();

    // pepite frame_1/DoAction.as physics
    const currentH = this.h;
    this.h += 0.5;

    const amp = 60 - currentH;
    const dh = Math.floor(Math.random() * 5);
    const x = amp * (-0.5 + Math.random());
    const t = 30 + 70 * Math.random();
    const vx = -0.5 + Math.random();
    const rotation = Math.floor(Math.random() * 360);

    // Apply initial transform
    anim.sprite.rotation = (rotation * Math.PI) / 180;
    anim.sprite.scale.set(
      (t / 100) * this.pepiteScale,
      (t / 100) * this.pepiteScale,
    );
    anim.sprite.position.set(x, -90);

    this.pepiteContainer.addChild(anim.sprite);

    const particle: PepiteParticle = {
      anim,
      x,
      y: -90,
      vx,
      vy: 0,
      g: 0.6,
      h: currentH,
      dh,
      stopped: false,
    };

    this.particles.push(particle);
  }

  private updateParticle(p: PepiteParticle): void {
    if (p.stopped) {
      return;
    }

    p.x += p.vx;
    p.vy += p.g;
    p.y += p.vy;

    if (p.y > -p.h) {
      p.y = -p.h;
      p.h -= Math.floor(Math.random() * Math.round(p.dh));
      p.dh = p.dh * (0.5 + 0.5 * Math.random());
      p.vx *= 0.23;
      p.vy = (-p.vy) / (3 + Math.floor(Math.random() * 7));
      p.stopped = true;
    }

    p.anim.sprite.position.set(p.x, p.y);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.frameAccumulator += deltaTime;

    while (this.frameAccumulator >= this.frameTime) {
      this.frameAccumulator -= this.frameTime;
      this.tickFrame();
    }
  }

  private tickFrame(): void {
    this.currentFrame++;

    // Spawn pepites: c starts at 1, spawns while c < 120, increments each frame
    // AS: c = 1; if(c < 120) { attachMovie; c++; }
    // So we spawn one per frame for frames 1..119 (119 particles total)
    if (this.spawnCount < 120) {
      this.spawnPepite();
      this.spawnCount++;
    }

    // Update all particles
    for (const p of this.particles) {
      this.updateParticle(p);
    }

    // Frame 127 (0-indexed: 126): start fading out the container
    // AS: DefineSprite_8/frame_127: _parent._alpha -= 5 per enterFrame
    if (this.currentFrame >= 126) {
      this.fadingOut = true;
    }

    if (this.fadingOut) {
      // _alpha is 0-100 in AS, we use 0-1 in PixiJS
      this.containerAlpha -= 5 / 100;
      if (this.containerAlpha < 0) {
        this.containerAlpha = 0;
      }
      this.pepiteContainer.alpha = this.containerAlpha;
    }

    // Signal hit at first spawn (frame 1)
    if (this.currentFrame === 1) {
      this.signalHit();
    }

    // Frame 160 (0-indexed: 159): removeMovieClip, stop
    if (this.currentFrame >= 159) {
      this.complete();
    }
  }

  destroy(): void {
    for (const p of this.particles) {
      p.anim.destroy();
    }
    this.particles = [];
    super.destroy();
  }
}
