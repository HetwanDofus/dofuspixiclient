# Spell Implementation Guide

## Overview
This directory contains TypeScript implementations of Dofus 1.29 spell animations. Each spell must behave **EXACTLY** as the original ActionScript code describes - no approximations, no "improvements", no deviations.

## Directory Structure
```
tools/combat-exporter/
├── output/spell-anims/{SPELL_ID}/
│   ├── manifest.json          # Sprite dimensions, animations, library symbols
│   └── scripts/               # Decompiled ActionScript files
├── spell-interface.ts         # ISpellAnimation interface and types
├── spell-utils/               # Utility classes (FrameAnimatedSprite, ASParticleSystem, etc.)
└── test-player/src/spells/    # TypeScript implementations (this directory)
```

## Creating a New Spell Implementation

### Step 1: Read ALL ActionScript Files
The ActionScript files in `output/spell-anims/{SPELL_ID}/scripts/` are the **source of truth**. Read every single `.as` file to understand:
- Frame-by-frame behavior
- Particle spawning formulas (count, physics, timing)
- Sound triggers
- Hit/end timing
- Transform calculations
- Randomization logic

### Step 2: Read the Manifest
The `manifest.json` contains:
- `animations[]`: Sprite data (name, frameCount, width, height, offsetX, offsetY)
- `librarySymbols[]`: Symbols used via `attachMovie()`
- `sounds[]`: Sound trigger data
- `fps`: Frame rate (usually 60)
- `scale`: Extraction scale (usually 6)

### Step 3: Implement EXACTLY as ActionScript Describes

**CRITICAL**: The TypeScript implementation must produce identical behavior to the original AS code:

- **Frame timing**: If AS says `gotoAndPlay(7)`, use frame index 6 (0-indexed)
- **Particle formulas**: Copy the exact math: `nb = 10 + _parent.level * 3` → `count = 10 + level * 3`
- **Physics**: Copy exact values: `accX = 0.8 + 0.12 * Math.random()` - don't round, don't simplify
- **Randomization**: Use the same random ranges: `random(90) + 2` → `Math.floor(Math.random() * 90) + 1` (0-indexed)
- **Sound timing**: Play sounds at the exact frame specified
- **Hit timing**: Signal hit at the exact frame AS calls `this.end()` or equivalent

### Frame Index Conversion
ActionScript frames are **1-indexed**, TypeScript uses **0-indexed**:
- AS `frame_7/DoAction.as` → frame index 6
- AS `gotoAndPlay(43)` → `startFrame: 42`
- AS `stop()` at frame 148 → `stopAt(147)`

### Required Imports
```typescript
import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,  // If spell uses attachMovie for particles
  calculateAnchor,
  decomposeFlashTransform,  // If spell has transform matrices
  type SpriteManifest,
  type FlashTransform,  // If needed
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';
```

### Class Structure (using BaseSpell)
```typescript
/**
 * Spell {ID} - {Name}
 *
 * {Brief description}
 *
 * Components:
 * - {sprite_name}: {role} at {position}
 *
 * Original AS timing:
 * - Frame {N}: {action}
 */
export class Spell{ID} extends BaseSpell {
  readonly spellId = {ID};

  private myAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Register animations with this.anims.add() for automatic management
    this.myAnim = this.anims.add(new FrameAnimatedSprite({...}));

    // Use init for pre-calculated values
    // Use this.callbacks for sound/events
    // Use this.signalHit() for hit signal (auto-guarded)
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all registered animations at once
    this.anims.update(deltaTime);

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }

  // Only override destroy() if you have extra resources (particles, etc.)
  destroy(): void {
    this.particles.destroy();
    super.destroy();  // Handles anims and container
  }
}
```

### BaseSpell Features

**SpellInitContext** - Pre-calculated values provided to `setup()`:
```typescript
interface SpellInitContext {
  scale: number;      // 1 / SPELL_CONSTANTS.EXTRACTION_SCALE
  angleRad: number;   // context.angle in radians
  casterY: number;    // SPELL_CONSTANTS.Y_OFFSET
  targetX: number;    // cellTo.x - cellFrom.x (or 0)
  targetY: number;    // cellTo.y - cellFrom.y + Y_OFFSET
}
```

**AnimationManager** (`this.anims`) - Manages multiple animations:
```typescript
// Register animation for automatic update/destroy
this.myAnim = this.anims.add(new FrameAnimatedSprite({...}));

// Update all at once
this.anims.update(deltaTime);

// Check completion
if (this.anims.allComplete()) { ... }
if (this.anims.allStopped()) { ... }

// Destroyed automatically by super.destroy()
```

**Built-in methods** (auto-guarded, only fire once):
```typescript
this.signalHit();   // Calls callbacks.onHit()
this.complete();    // Sets done=true and calls callbacks.onComplete()
```

### Particle Systems
For spells using `attachMovie()`:
```typescript
// Get particle texture from library symbol
const particleTexture = textures.getFrames('lib_{symbolName}')[0];
this.particles = new ASParticleSystem(particleTexture);

// Spawn with EXACT AS physics
this.particles.spawnMany(count, () => {
  // Copy the EXACT formulas from AS
  const accX = 0.8 + 0.12 * Math.random();
  const x = d * Math.random();
  // ... etc
  return { x, y, vx, accX, vr, vrDecay: 0.97, t: 5, vt, vtDecay: 0.1 };
});
```

### Event Callbacks
```typescript
// Sound at specific frame (use 0-indexed frame numbers inline)
.onFrame(1, () => this.callbacks.playSound('sound_id'))

// Hit signal using BaseSpell method (auto-guarded)
.onFrame(12, () => this.signalHit())

// Completion check in update()
if (this.impactAnim.isComplete() && !this.particles.hasAliveParticles()) {
  this.complete();
}
```

## Reference Implementations
- `base-spell.ts` - Base class with AnimationManager, signalHit(), complete()
- `spell-909.ts` - Beam spell with particle system (extends BaseSpell)
- `spell-1005.ts` - Radial effect with 32 randomized ray instances

## Common Mistakes to Avoid
1. **Wrong frame indexing** - Always subtract 1 from AS frame numbers
2. **Approximating formulas** - Copy math exactly, don't "simplify"
3. **Missing randomization** - If AS uses `random()`, the TS must too
4. **Wrong scale** - Always apply 1/6 scale to sprites
5. **Missing sounds** - Check all AS files for `SOMA.playSound()`
6. **Wrong completion timing** - Wait for ALL animations AND particles to finish
