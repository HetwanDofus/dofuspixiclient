/**
 * Spell 1015 - Flèche Punitive (Cra)
 *
 * A projectile spell where an arrow/fragment travels from caster to target,
 * leaving trailing fragments, then a sun/impact animation plays at the target.
 *
 * Components:
 * - gen (PlaceObject2_15): A "generator" object at caster position (Y - 100),
 *   drives the projectile movement via enterFrame logic
 * - frag (sprite_10): Fragment sprites spawned along the trajectory every 5 frames
 * - sol (sprite_5): Sun/impact animation spawned at the final position
 * - DefineSprite_21: Main container placed at cellTo, signals hit at frame 52,
 *   removes at frame 124
 *
 * Original AS timing:
 * - Frame 2 (main): stop() — animation is driven by enterFrame
 * - gen onClipEvent(load): Position at cellFrom.x, cellFrom.y - 100
 * - gen onClipEvent(enterFrame): Move projectile, spawn frags every 5 frames,
 *   spawn sol when reaching limy (cellFrom.y - 100 + 90 + random*20)
 * - DefineSprite_21 frame_1: Position at cellTo
 * - DefineSprite_21 frame_52: this.end() → signal hit
 * - DefineSprite_21 frame_124: removeMovieClip() → complete
 * - DefineSprite_5_sol frame_85: stop()
 * - DefineSprite_10_frag frame_70: removeMovieClip()
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  SPELL_CONSTANTS,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

interface FragInstance {
  anim: FrameAnimatedSprite;
  dead: boolean;
}

export class Spell1015 extends BaseSpell {
  readonly spellId = 1015;

  // Projectile state (replicating PlaceObject2_16_5 enterFrame)
  private genX = 0;
  private genY = 0;
  private angle = 90;
  private vr = 0;
  private limy = 0;
  private genDone = false;
  private c = 0;

  // Fragment and sol instances
  private frags: FragInstance[] = [];
  private solAnim: FrameAnimatedSprite | null = null;

  // Container for all dynamic elements (positioned relative to cellFrom)
  private worldContainer!: Container;

  // Textures stored for spawning
  private fragTextures: Texture[] = [];
  private solTextures: Texture[] = [];
  private fragAnchorX = 0.5;
  private fragAnchorY = 0.5;
  private solAnchorX = 0.5;
  private solAnchorY = 0.5;

  // DefineSprite_21 timeline (signals hit at frame 52, completes at frame 124)
  private sprite21FrameAccumulator = 0;
  private sprite21Frame = 0;
  private sprite21Done = false;

  // Track if sol has been spawned
  private solSpawned = false;

  // Accumulated time for enterFrame simulation (runs at 60fps)
  private enterFrameAccumulator = 0;
  private readonly frameTime = 1000 / 60;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, _init: SpellInitContext): void {
    // Store textures for later spawning
    this.fragTextures = textures.getFrames('lib_frag');
    this.solTextures = textures.getFrames('lib_sol');

    const fragAnchor = calculateAnchor({
      width: 687.05,
      height: 44.95,
      offsetX: -346.2,
      offsetY: -22.95,
    });
    this.fragAnchorX = fragAnchor.x;
    this.fragAnchorY = fragAnchor.y;

    const solAnchor = calculateAnchor({
      width: 132.05,
      height: 90.3,
      offsetX: -69.7,
      offsetY: -82.45,
    });
    this.solAnchorX = solAnchor.x;
    this.solAnchorY = solAnchor.y;

    // In AS world space:
    // gen starts at: (cellFrom.x, cellFrom.y - 100)
    // In our local container space (origin = cellFrom):
    // gen starts at: (0, -100)
    // limy = genY + 90 + random*20 = -100 + 90 + random*20 = -10 + random*20
    this.genX = 0;
    this.genY = -100;
    this.angle = 90; // BASE = 90
    this.vr = (Math.random() - 0.5) * 5;
    this.limy = this.genY + 90 + Math.random() * 20;
    this.genDone = false;
    this.c = 0;

    // World container for frags and sol
    this.worldContainer = new Container();
    this.worldContainer.position.set(0, 0);
    this.container.addChild(this.worldContainer);

    // DefineSprite_21 timeline starts immediately
    this.sprite21Frame = 0;
    this.sprite21FrameAccumulator = 0;
    this.sprite21Done = false;
    this.solSpawned = false;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Process enterFrame logic at 60fps
    this.enterFrameAccumulator += deltaTime;
    while (this.enterFrameAccumulator >= this.frameTime) {
      this.enterFrameAccumulator -= this.frameTime;
      this.processEnterFrame();
    }

    // Update sprite_21 timeline (signals hit and completion)
    if (!this.sprite21Done) {
      this.sprite21FrameAccumulator += deltaTime;
      while (this.sprite21FrameAccumulator >= this.frameTime && !this.sprite21Done) {
        this.sprite21FrameAccumulator -= this.frameTime;
        this.sprite21Frame++;

        // AS frame_52 (0-indexed: 51) → this.end() → signal hit
        if (this.sprite21Frame === 51) {
          this.signalHit();
        }

        // AS frame_124 (0-indexed: 123) → removeMovieClip → complete
        if (this.sprite21Frame === 123) {
          this.sprite21Done = true;
        }
      }
    }

    // Update sol animation (managed via this.anims)
    this.anims.update(deltaTime);

    // Update frag instances manually (not in this.anims to avoid affecting allComplete())
    for (const frag of this.frags) {
      if (!frag.dead) {
        frag.anim.update(deltaTime);
        if (frag.anim.isStopped() || frag.anim.isComplete()) {
          frag.dead = true;
          frag.anim.destroy();
        }
      }
    }

    // Check completion: sprite_21 done, sol stopped/complete, all frags dead
    const solDone = this.solAnim === null || this.solAnim.isStopped() || this.solAnim.isComplete();
    const allFragsDead = this.frags.every(f => f.dead);

    if (this.sprite21Done && solDone && allFragsDead && this.solSpawned) {
      this.complete();
    }
  }

  private processEnterFrame(): void {
    if (this.genDone) {
      return;
    }

    // AS: if(_Y < limy) { ... } else { done = true; attachMovie sol }
    if (this.genY < this.limy) {
      // AS: if(c++ % 5 == 0) { vr = (Math.random() - 0.5) * 50; }
      // c++ returns value before increment: first iteration c=0 → 0%5==0 → true, then c=1
      if (this.c % 5 === 0) {
        this.vr = (Math.random() - 0.5) * 50;
      }
      this.c++;

      // AS: angle = Math.max(BASE - LIM, Math.min(BASE + LIM, angle + vr))
      // BASE = 90, LIM = 50
      this.angle = Math.max(90 - 50, Math.min(90 + 50, this.angle + this.vr));

      // AS: var rad = angle * DEG2RAD
      const DEG2RAD = 0.017453292519943295;
      const rad = this.angle * DEG2RAD;

      // AS: _X += VEL * cos(rad); _Y += VEL * sin(rad)  (VEL = 7.67)
      this.genX = this.genX + 7.67 * Math.cos(rad);
      this.genY = this.genY + 7.67 * Math.sin(rad);

      // AS: rootMC.attachMovie("frag", "frag" + c, c, {_x:_X, _y:_Y})
      this.spawnFrag(this.genX, this.genY, this.angle);
    } else {
      // AS: done = true; rootMC.attachMovie("sol", "solImpact", 1000, {_x:_X, _y:_Y})
      this.genDone = true;
      this.spawnSol(this.genX, this.genY);
    }
  }

  private spawnFrag(x: number, y: number, rotationDeg: number): void {
    if (this.fragTextures.length === 0) {
      return;
    }

    const anim = new FrameAnimatedSprite({
      textures: this.fragTextures,
      anchorX: this.fragAnchorX,
      anchorY: this.fragAnchorY,
      scale: 1,
    });

    // AS DefineSprite_10_frag frame_1: _X = gen._x, _Y = gen._y, _rotation = gen._rotation
    anim.sprite.position.set(x, y);
    anim.sprite.rotation = (rotationDeg * Math.PI) / 180;

    // AS DefineSprite_10_frag frame_70: removeMovieClip(this)
    // Stop at frame 69 (0-indexed), handled in update() via isStopped()
    anim.stopAt(69);

    this.worldContainer.addChild(anim.sprite);
    this.frags.push({ anim, dead: false });
  }

  private spawnSol(x: number, y: number): void {
    if (this.solTextures.length === 0 || this.solSpawned) {
      return;
    }

    this.solSpawned = true;

    const anim = this.anims.add(new FrameAnimatedSprite({
      textures: this.solTextures,
      anchorX: this.solAnchorX,
      anchorY: this.solAnchorY,
      scale: 1,
    }));

    // AS DefineSprite_5_sol frame_1: _X = gen._x, _Y = gen._y
    anim.sprite.position.set(x, y);

    // AS DefineSprite_5_sol frame_85: stop()
    // 0-indexed: frame 84
    anim.stopAt(84);

    this.worldContainer.addChild(anim.sprite);
    this.solAnim = anim;
  }

  override destroy(): void {
    // Clean up frag animations that are not in this.anims
    for (const frag of this.frags) {
      if (!frag.dead) {
        frag.anim.destroy();
      }
    }
    this.frags = [];

    super.destroy();
  }
}
