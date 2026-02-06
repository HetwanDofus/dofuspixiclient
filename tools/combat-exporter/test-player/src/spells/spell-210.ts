/**
 * Spell 210 - Griffes Spectres
 *
 * A claw attack spell that spawns multiple randomized claw animations.
 *
 * Components:
 * - Multiple claw instances (griffes): Spawned with random Y positions and rotations
 * - Two controller sprites that manage the spawning
 *
 * Original AS timing:
 * - Frame 1: Play sound "crockette_201", initialize cpt=0
 * - Frame 1: First controller starts at rotation random(90)+135
 * - Frame 1: Second controller starts at frame 18 with rotation random(90)-45
 * - Frame 7: Play sound "lance02"
 * - Frame 13: Spawn claw instance
 * - Frame 163: Complete spell
 * - Claw animations stop at frame 28
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const CONTROLLER_MANIFEST: SpriteManifest = {
  width: 0,
  height: 0,
  offsetX: 0,
  offsetY: 0,
};

const CLAW_MANIFEST: SpriteManifest = {
  width: 367.5,
  height: 230.7,
  offsetX: -145.8,
  offsetY: -129.6,
};

export class Spell210 extends BaseSpell {
  readonly spellId = 210;

  private controllerAnim!: FrameAnimatedSprite;
  private cpt = 0;
  private clawInstances: FrameAnimatedSprite[] = [];

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play initial sound
    this.callbacks.playSound('crockette_201');

    // Create invisible controller animation (manages the spell timing)
    this.controllerAnim = this.anims.add(new FrameAnimatedSprite({
      textures: Array(163).fill(Texture.EMPTY),
      ...calculateAnchor(CONTROLLER_MANIFEST),
      scale: init.scale,
    }));
    this.controllerAnim
      .stopAt(162)
      .onFrame(6, () => this.callbacks.playSound('lance02'))
      .onFrame(12, () => this.spawnFirstClaw(textures, init))
      .onFrame(30, () => this.spawnSecondClaw(textures, init));
    this.container.addChild(this.controllerAnim.sprite);
  }

  private spawnFirstClaw(textures: SpellTextureProvider, init: SpellInitContext): void {
    // First claw with rotation random(90) + 135
    const rotation = (Math.floor(Math.random() * 90) + 135) * Math.PI / 180;
    const yPos = Math.floor(Math.random() * 40) - 40;
    
    if (this.cpt <= 6) {
      this.spawnClaw(textures, init, yPos, rotation);
    }
  }

  private spawnSecondClaw(textures: SpellTextureProvider, init: SpellInitContext): void {
    // Second claw with rotation random(90) - 45, starting at frame 18
    const rotation = (Math.floor(Math.random() * 90) - 45) * Math.PI / 180;
    const yPos = Math.floor(Math.random() * 40) - 40;
    
    if (this.cpt <= 6) {
      const claw = this.anims.add(new FrameAnimatedSprite({
        textures: textures.getFrames('lib_griffes'),
        ...calculateAnchor(CLAW_MANIFEST),
        scale: init.scale,
        startFrame: 17, // AS frame 18
      }));
      claw.sprite.position.set(0, yPos);
      claw.sprite.rotation = rotation;
      claw.stopAt(27); // AS frame 28
      this.container.addChild(claw.sprite);
      this.clawInstances.push(claw);
      this.cpt++;
    }
  }

  private spawnClaw(textures: SpellTextureProvider, init: SpellInitContext, yPos: number, rotation: number): void {
    const claw = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('lib_griffes'),
      ...calculateAnchor(CLAW_MANIFEST),
      scale: init.scale,
    }));
    claw.sprite.position.set(0, yPos);
    claw.sprite.rotation = rotation;
    claw.stopAt(27); // AS frame 28
    this.container.addChild(claw.sprite);
    this.clawInstances.push(claw);
    this.cpt++;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Check if main controller animation is complete
    if (this.controllerAnim.isComplete()) {
      this.signalHit();
      this.complete();
    }
  }
}