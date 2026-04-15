/**
 * Spell 201 - Griffes (Iop)
 *
 * A claw attack spell that spawns multiple "griffes" (claw) instances
 * in a wave pattern at the target position.
 *
 * Structure:
 * - DefineSprite_7: Main container with two initial griffes instances placed at frame 1
 *   - PlaceObject2_6_1 (first griffe): rotation = random(90) + 135, depth 1100
 *   - PlaceObject2_6_3 (second griffe): rotation = random(90) - 45, starts at frame 18, depth 1000
 * - DefineSprite_6: A "launcher" clip that spawns more griffes every 13 frames (up to 7 total)
 * - DefineSprite_3: A fading horizontal sprite (_X decreases, _alpha fades)
 *
 * Timing:
 * - Frame 1 (main): Play sound 'crockette_201'
 * - Frame 7 (launcher): Play sound 'lance02'
 * - Frame 13 (launcher): Attach a new "griffes" instance (up to cpt <= 6, so 7 total)
 * - Frame 163 (DefineSprite_7): removeMovieClip -> spell ends
 * - Frame 28 (griffes): removeMovieClip
 *
 * Implementation approach:
 * - Spawn 2 initial griffes at t=0 (first and second, with different rotations/start frames)
 * - DefineSprite_6 loops and at frame 13 attaches a new griffe (cpt 0..6)
 *   but since frame_1/DoAction sets _Y = random(40) - 40 and checks cpt > 6 to stop,
 *   up to 7 griffes are spawned by the launcher (but the two from PlaceObject2 are separate)
 * - Each griffe plays 30 frames then self-removes
 *
 * Original AS timing (1-indexed → 0-indexed):
 * - Sound 'crockette_201' at main frame 1 → frame index 0
 * - Sound 'lance02' at DefineSprite_6 frame 7 → frame index 6
 * - New griffe attached at DefineSprite_6 frame 13 → frame index 12
 * - DefineSprite_6 loops (if cpt <= 6 it plays, else stops)
 * - DefineSprite_7 ends at frame 163 → frame index 162
 * - griffes clip self-removes at frame 28 → frame index 27 (stopAt 27)
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
 * One animated "griffes" clip instance.
 * Each has its own rotation, Y offset, and start frame.
 */
interface GriffeInstance {
  anim: FrameAnimatedSprite;
  alive: boolean;
}

export class Spell201 extends BaseSpell {
  readonly spellId = 201;

  private griffeContainer!: Container;
  private griffeInstances: GriffeInstance[] = [];

  // Launcher state (DefineSprite_6)
  private launcherFrameTime = 1000 / 60;
  private launcherAccum = 0;
  private launcherFrame = 0; // 0-indexed
  private launcherCpt = 0;
  private launcherStopped = false;
  private launcherSoundPlayed = false;

  // Main timeline
  private mainFrameTime = 1000 / 60;
  private mainAccum = 0;
  private mainFrame = 0;

  // Textures for spawning new griffes
  private griffeTextures: ReturnType<SpellTextureProvider["getFrames"]> = [];
  private anchor = { x: 0, y: 0 };
  private spellScale = 1;
  private launcherY = 0; // current _Y for launcher

  // Hit signaled when first griffe is attached
  private firstGriffeAttached = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.spellScale = init.scale;
    this.griffeTextures = textures.getFrames("lib_griffes");
    this.anchor = calculateAnchor(GRIFFES_MANIFEST);

    // Container at target position
    this.griffeContainer = new Container();
    this.griffeContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.griffeContainer);

    // Play main frame 1 sound
    this.callbacks.playSound("crockette_201");

    // --- PlaceObject2_6_3 (second instance, load: rotation = random(90) - 45, gotoAndPlay(18)) ---
    // depth 1000 → placed first (lower z-order)
    const rotation3 = Math.floor(Math.random() * 90) - 45;
    this.spawnGriffe(0, 17, rotation3, 0); // startFrame=17 (AS gotoAndPlay(18) → 0-indexed 17)

    // --- PlaceObject2_6_1 (first instance, load: rotation = random(90) + 135) ---
    // depth 1100 → placed on top
    const rotation1 = Math.floor(Math.random() * 90) + 135;
    this.spawnGriffe(0, 0, rotation1, 0);

    // Initialize launcher Y for the first cycle
    this.launcherY = Math.floor(Math.random() * 40) - 40;
  }

  private spawnGriffe(
    yOffset: number,
    startFrame: number,
    rotationDeg: number,
    _depth: number
  ): GriffeInstance {
    const anim = new FrameAnimatedSprite({
      textures: this.griffeTextures,
      fps: 60,
      startFrame,
      anchorX: this.anchor.x,
      anchorY: this.anchor.y,
      scale: this.spellScale,
    });

    anim.sprite.y = yOffset;
    anim.sprite.rotation = (rotationDeg * Math.PI) / 180;

    // griffes clip: at frame 28 (0-indexed 27) it removeMovieClip → stopAt 27 then mark dead
    anim.stopAt(27);

    const instance: GriffeInstance = { anim, alive: true };
    anim.onStop(() => {
      instance.alive = false;
    });

    this.griffeContainer.addChild(anim.sprite);
    this.griffeInstances.push(instance);

    return instance;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // --- Update main timeline (DefineSprite_7 ends at frame 163, 0-indexed 162) ---
    this.mainAccum += deltaTime;
    while (this.mainAccum >= this.mainFrameTime) {
      this.mainAccum -= this.mainFrameTime;
      this.mainFrame++;

      if (this.mainFrame >= 162) {
        // DefineSprite_7 frame 163: removeMovieClip → end
        this.complete();
        return;
      }
    }

    // --- Update launcher (DefineSprite_6) ---
    if (!this.launcherStopped) {
      this.launcherAccum += deltaTime;
      while (
        this.launcherAccum >= this.launcherFrameTime &&
        !this.launcherStopped
      ) {
        this.launcherAccum -= this.launcherFrameTime;
        this.launcherFrame++;

        // Frame 6 (0-indexed): play sound 'lance02'
        if (this.launcherFrame === 6 && !this.launcherSoundPlayed) {
          this.launcherSoundPlayed = false; // reset for loop
          this.callbacks.playSound("lance02");
          this.launcherSoundPlayed = true;
        }

        // Frame 12 (0-indexed, AS frame 13): attach new griffes
        if (this.launcherFrame === 12) {
          if (this.launcherCpt > 6) {
            // stop() called in frame_1 when cpt > 6
            this.launcherStopped = true;
          } else {
            // Attach griffes at _parent.cpt
            const newY = this.launcherY;
            const newRotation = this.computeCurrentLauncherRotation();
            this.spawnGriffe(newY, 0, newRotation, this.launcherCpt + 100);

            // Signal hit when first griffe from launcher is attached
            if (!this.firstGriffeAttached) {
              this.firstGriffeAttached = true;
              this.signalHit();
            }

            this.launcherCpt++;
          }
        }

        // After frame 12 (the loop point), restart launcher frame counter
        // DefineSprite_6 loops: frame 13 is last content frame, then it loops back to frame 1
        // Frame 1 DoAction: _Y = random(40) - 40; check cpt > 6
        if (this.launcherFrame >= 12) {
          // Loop back to frame 0 (AS frame 1)
          this.launcherFrame = 0;
          this.launcherSoundPlayed = false;

          // Frame 1 DoAction on next loop
          this.launcherY = Math.floor(Math.random() * 40) - 40;

          if (this.launcherCpt > 6) {
            this.launcherStopped = true;
          }
        }
      }
    }

    // --- Update each griffe's onEnterFrame rotation logic ---
    // PlaceObject2_6_1: if currentframe == 1 → rotation = random(90) + 135
    // PlaceObject2_6_3: if currentframe == 1 → rotation = random(90) - 45
    // These are the two initial instances (indices 0 and 1 in griffeInstances after spawn)
    // We track them by checking frame == 0 (0-indexed)
    for (let i = 0; i < this.griffeInstances.length; i++) {
      const inst = this.griffeInstances[i];
      if (!inst.alive) {
        continue;
      }

      // Apply enterFrame rotation re-randomization for the two placed instances
      if (i === 0) {
        // PlaceObject2_6_3 (spawned first, rotation = random(90) - 45)
        if (inst.anim.getFrame() === 0) {
          inst.anim.sprite.rotation =
            ((Math.floor(Math.random() * 90) - 45) * Math.PI) / 180;
        }
      } else if (i === 1) {
        // PlaceObject2_6_1 (spawned second, rotation = random(90) + 135)
        if (inst.anim.getFrame() === 0) {
          inst.anim.sprite.rotation =
            ((Math.floor(Math.random() * 90) + 135) * Math.PI) / 180;
        }
      }

      inst.anim.update(deltaTime);
    }

    // Check completion: main timeline drives the end (frame 162)
    // But we also check if all griffes are done and launcher stopped
    if (this.launcherStopped) {
      const allDead = this.griffeInstances.every((inst) => !inst.alive);
      if (allDead) {
        this.complete();
      }
    }
  }

  private computeCurrentLauncherRotation(): number {
    // The launcher clips (PlaceObject2_6_1 / _6_3) had _rotation set on load.
    // The newly attached griffes get: eval("_parent.griffes" + cpt)._rotation = _rotation
    // where _rotation is the launcher's (DefineSprite_6 instance's) rotation.
    // However DefineSprite_6 doesn't have explicit rotation in the scripts shown,
    // so we default to 0. The two initial clips have their own rotations.
    // For spawned griffes from the launcher we use 0.
    return 0;
  }

  destroy(): void {
    for (const inst of this.griffeInstances) {
      inst.anim.destroy();
    }
    this.griffeInstances = [];
    super.destroy();
  }
}
