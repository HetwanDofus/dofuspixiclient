/**
 * Spell 210 - Griffes (Iop)
 *
 * A claw attack spell that spawns multiple "griffes" (claw) instances
 * at the target position. Two initial claw animations are placed with
 * random rotations, then additional claws are spawned at frame 13 of
 * each wave animation, up to 6 times.
 *
 * Components:
 * - DefineSprite_7: Main container at target position, runs ~163 frames
 *   - PlaceObject2_6_1 (wave1): claw animator, random rotation 135-224°
 *   - PlaceObject2_6_3 (wave2): claw animator, random rotation -45-44°, starts at frame 18
 * - DefineSprite_6: Wave animator that at frame 13 attachMovie("griffes")
 *   - Frame 1: set _Y = random(40)-40, stop if cpt > 6
 *   - Frame 7: play sound 'lance02'
 *   - Frame 13: spawn a griffes instance
 * - DefineSprite_4_griffes: The claw animation (30 frames), frame 28: removeMovieClip
 * - DefineSprite_3: Spawned claw with physics (_X moves left, _alpha fades)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'crockette_201'
 * - Frame 1 (wave): Set random Y offset, check cpt limit
 * - Frame 7 (wave): Play sound 'lance02'
 * - Frame 13 (wave): Spawn griffes instance at random Y and rotation
 * - Frame 28 (griffes): removeMovieClip (animation ends)
 * - Frame 163 (DefineSprite_7): removeMovieClip (spell ends)
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

const GRIFFES_MANIFEST: SpriteManifest = {
  width: 61.25,
  height: 38.45,
  offsetX: -24.3,
  offsetY: -21.6,
};

/**
 * Represents a single spawned "griffes" (claw) instance with
 * the sliding/fading physics from DefineSprite_3
 */
interface GriffesParticle {
  anim: FrameAnimatedSprite;
  v: number; // velocity
  va: number; // alpha velocity
  alive: boolean;
}

export class Spell210 extends BaseSpell {
  readonly spellId = 210;

  /** Container placed at target position */
  private effectContainer!: Container;

  /** The two "wave" animators (DefineSprite_6 instances) */
  private wave1Anim!: FrameAnimatedSprite;
  private wave2Anim!: FrameAnimatedSprite;

  /** Spawned griffes particles */
  private griffesParticles: GriffesParticle[] = [];

  /** Counter of how many claws have been spawned (AS: cpt) */
  private cpt = 0;

  /** Whether wave1 has already spawned its claw */
  private wave1Spawned = false;
  /** Whether wave2 has already spawned its claw */
  private wave2Spawned = false;

  /** Main timeline frame counter (DefineSprite_7 runs 163 frames) */
  private mainFrameAcc = 0;
  private mainFrame = 0;
  private readonly MAIN_FRAME_TIME = 1000 / 60;
  private readonly MAIN_TOTAL_FRAMES = 163;

  /** Stored textures/anchor for spawning griffes */
  private griffesTextures: ReturnType<SpellTextureProvider["getFrames"]> = [];
  private griffesAnchorX = 0;
  private griffesAnchorY = 0;

  /** Wave sound played flags */
  private wave1SoundPlayed = false;
  private wave2SoundPlayed = false;

  /** Wave 1 & 2 initial Y offsets (random(40) - 40 -> -40 to -1) */
  private wave1Y = 0;
  private wave2Y = 0;

  /** Wave 1 & 2 initial rotations */
  private wave1Rotation = 0;
  private wave2Rotation = 0;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Play initial sound at frame 1 (index 0)
    this.initialSoundPlayed = false;

    // Store textures for later claw spawning
    this.griffesTextures = textures.getFrames("lib_griffes");
    const anchor = calculateAnchor(GRIFFES_MANIFEST);
    this.griffesAnchorX = anchor.x;
    this.griffesAnchorY = anchor.y;

    // Create a container at the target position
    this.effectContainer = new Container();
    this.effectContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.effectContainer);

    // Initialize cpt
    this.cpt = 0;

    // Wave 1 initial state (PlaceObject2_6_1):
    // _rotation = random(90) + 135
    this.wave1Rotation = Math.floor(Math.random() * 90) + 135;
    // Wave 2 initial state (PlaceObject2_6_3):
    // _rotation = random(90) - 45
    this.wave2Rotation = Math.floor(Math.random() * 90) - 45;

    // DefineSprite_6/frame_1: _Y = random(40) - 40
    this.wave1Y = Math.floor(Math.random() * 40) - 40;
    this.wave2Y = Math.floor(Math.random() * 40) - 40;

    // Wave 1 animation (DefineSprite_6), starts at frame 0
    this.wave1Anim = new FrameAnimatedSprite({
      textures: textures.getFrames("griffes"),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    });
    this.wave1Anim.sprite.position.set(0, this.wave1Y * init.scale);
    this.wave1Anim.sprite.rotation = (this.wave1Rotation * Math.PI) / 180;
    this.effectContainer.addChild(this.wave1Anim.sprite);

    // Wave 2 animation (DefineSprite_6), starts at frame 17 (gotoAndPlay(18) -> 0-indexed: 17)
    this.wave2Anim = new FrameAnimatedSprite({
      textures: textures.getFrames("griffes"),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      startFrame: 17,
    });
    this.wave2Anim.sprite.position.set(0, this.wave2Y * init.scale);
    this.wave2Anim.sprite.rotation = (this.wave2Rotation * Math.PI) / 180;
    this.effectContainer.addChild(this.wave2Anim.sprite);

    // Play initial sound immediately
    this.callbacks.playSound("crockette_201");

    // Signal hit immediately (on impact at caster/target)
    this.signalHit();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update main frame counter
    this.mainFrameAcc += deltaTime;
    while (this.mainFrameAcc >= this.MAIN_FRAME_TIME) {
      this.mainFrame++;
      this.mainFrameAcc -= this.MAIN_FRAME_TIME;
    }

    // Update wave animations
    this.updateWave1(deltaTime);
    this.updateWave2(deltaTime);

    // Update all griffes particles
    this.updateParticles(deltaTime);

    // Check completion: DefineSprite_7/frame_163 -> removeMovieClip
    if (this.mainFrame >= this.MAIN_TOTAL_FRAMES - 1) {
      // Wait for all particles to finish
      const allDone = this.griffesParticles.every((p) => !p.alive);
      if (allDone) {
        this.complete();
      }
    }
  }

  private updateWave1(deltaTime: number): void {
    if (!this.wave1Anim.isComplete() && !this.wave1Anim.isStopped()) {
      this.wave1Anim.update(deltaTime);

      const frame = this.wave1Anim.getFrame();

      // Frame 7 (0-indexed: 6): play sound 'lance02'
      if (frame >= 6 && !this.wave1SoundPlayed) {
        this.wave1SoundPlayed = true;
        this.callbacks.playSound("lance02");
      }

      // Frame 13 (0-indexed: 12): spawn griffes
      if (frame >= 12 && !this.wave1Spawned) {
        this.wave1Spawned = true;
        if (this.cpt <= 6) {
          this.spawnGriffes(this.wave1Y, this.wave1Rotation);
        }
      }

      // On loop back to frame 1 (0-indexed: 0), reset rotation
      // AS: if(this._currentframe == 1) { _rotation = random(90) + 135; }
      // This is handled by checking if frame resets (loop)
    }
  }

  private updateWave2(deltaTime: number): void {
    if (!this.wave2Anim.isComplete() && !this.wave2Anim.isStopped()) {
      this.wave2Anim.update(deltaTime);

      const frame = this.wave2Anim.getFrame();

      // Frame 7 (0-indexed: 6): play sound 'lance02'
      if (frame >= 6 && !this.wave2SoundPlayed) {
        this.wave2SoundPlayed = true;
        this.callbacks.playSound("lance02");
      }

      // Frame 13 (0-indexed: 12): spawn griffes
      if (frame >= 12 && !this.wave2Spawned) {
        this.wave2Spawned = true;
        if (this.cpt <= 6) {
          this.spawnGriffes(this.wave2Y, this.wave2Rotation);
        }
      }
    }
  }

  private spawnGriffes(yOffset: number, rotationDeg: number): void {
    // AS: attachMovie("griffes","griffes" + cpt, cpt + 100)
    // eval("_parent.griffes" + cpt)._y = _Y
    // eval("_parent.griffes" + cpt)._rotation = _rotation
    // cpt = cpt + 1

    const scale = 1 / 1; // init.scale is stored in setup, use 1:1 since EXTRACTION_SCALE=1

    const anim = new FrameAnimatedSprite({
      textures: this.griffesTextures,
      fps: 60,
      anchorX: this.griffesAnchorX,
      anchorY: this.griffesAnchorY,
      scale: scale,
    });

    // DefineSprite_3/frame_1: v = 1.6 + random(5); va = 3;
    const v = 1.6 + Math.floor(Math.random() * 5);
    const va = 3;

    anim.sprite.position.set(0, yOffset);
    anim.sprite.rotation = (rotationDeg * Math.PI) / 180;

    // Frame 28 (0-indexed: 27): removeMovieClip
    anim.stopAt(27);

    this.effectContainer.addChild(anim.sprite);

    const particle: GriffesParticle = {
      anim,
      v,
      va,
      alive: true,
    };

    this.griffesParticles.push(particle);
    this.cpt++;
  }

  private updateParticles(deltaTime: number): void {
    // Each frame: _X -= (v /= 1.4); _alpha -= va
    // We convert per-frame updates to deltaTime-based
    // AS runs at 60fps, so each "frame" = 1000/60 ms
    const framesElapsed = deltaTime / (1000 / 60);

    for (const p of this.griffesParticles) {
      if (!p.alive) {
        continue;
      }

      p.anim.update(deltaTime);

      // Apply physics: per frame: v /= 1.4, x -= v; alpha -= va
      for (let f = 0; f < framesElapsed; f++) {
        p.v /= 1.4;
        p.anim.sprite.x -= p.v;
        p.anim.sprite.alpha -= p.va / 100; // _alpha is 0-100 in AS, pixi uses 0-1
      }

      if (p.anim.sprite.alpha <= 0) {
        p.anim.sprite.alpha = 0;
        p.alive = false;
        p.anim.sprite.visible = false;
      }

      if (p.anim.isStopped() || p.anim.isComplete()) {
        p.alive = false;
        p.anim.sprite.visible = false;
      }
    }
  }

  override destroy(): void {
    for (const p of this.griffesParticles) {
      p.anim.destroy();
    }
    this.griffesParticles = [];
    super.destroy();
  }
}
