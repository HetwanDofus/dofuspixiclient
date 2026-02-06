import { Application, Assets, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellCallbacks, SpellTextureProvider, ISpellAnimation } from '../../spell-interface';
import { Spell1005 } from './spells/spell-1005';
import { Spell909 } from './spells/spell-909';

// ============================================================================
// SOUND MANAGER
// ============================================================================

class SoundManager {
  private audioCache: Map<string, HTMLAudioElement> = new Map();
  private basePath = '/sounds';

  async preload(soundIds: string[]): Promise<void> {
    const promises = soundIds.map(async (id) => {
      if (this.audioCache.has(id)) return;

      const audio = new Audio(`${this.basePath}/${id}.mp3`);
      audio.preload = 'auto';

      return new Promise<void>((resolve) => {
        audio.addEventListener('canplaythrough', () => {
          this.audioCache.set(id, audio);
          console.log(`Sound loaded: ${id}`);
          resolve();
        }, { once: true });

        audio.addEventListener('error', () => {
          console.warn(`Failed to load sound: ${id}`);
          resolve();
        }, { once: true });

        audio.load();
      });
    });

    await Promise.all(promises);
  }

  play(soundId: string): void {
    const cached = this.audioCache.get(soundId);
    if (cached) {
      // Clone the audio to allow overlapping plays
      const audio = cached.cloneNode() as HTMLAudioElement;
      audio.volume = 0.5;
      audio.play().catch(() => {
        // Ignore autoplay errors
      });
    } else {
      // Try to play directly if not cached
      const audio = new Audio(`${this.basePath}/${soundId}.mp3`);
      audio.volume = 0.5;
      audio.play().catch(() => {
        console.warn(`Sound not found: ${soundId}`);
      });
    }
  }
}

const soundManager = new SoundManager();

// ============================================================================
// MANIFEST TYPES
// ============================================================================

interface Transform {
  scaleX: number;
  scaleY: number;
  rotateSkew0: number;
  rotateSkew1: number;
  translateX: number;
  translateY: number;
}

interface Instance {
  depth: number;
  name: string | null;
  transform: Transform;
  colorTransform: null;
  blendMode: string;
  firstAppearance?: number;
}

interface ChildSpriteManifest {
  characterId: number;
  frameCount: number;
  instances: Instance[];
}

interface ChildSprite {
  characterId: number;
  name: string;
  frameCount: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  stopFrame?: number;
  frames: { index: number; file: string }[];
}

interface Animation {
  name: string;
  frameCount: number;
  isComposite: boolean;
  hasMorphShapes?: boolean;
  morphShapeCount?: number;
  stopFrame?: number;      // Frame with stop() action (0-indexed)
  fadingFrame?: number;    // Last visible frame before stop (stopFrame - 1)
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  composition: {
    parentFrameCount: number;
    children: ChildSpriteManifest[];
  };
  childSprites: ChildSprite[];
  frames: { index: number; file: string }[];
}

interface LibrarySymbol {
  name: string;
  characterId: number;
  internalName: string;
  frameCount: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frames: { index: number; file: string }[];
}

interface SoundTrigger {
  frame: number;
  soundId: string;
}

interface Manifest {
  id: number;
  fps: number;
  scale: number;
  mainTimelineScale?: number; // Scale applied by main timeline (some spells use < 1.0)
  animations: Animation[];
  scripts?: string[];
  librarySymbols?: LibrarySymbol[];
  sounds?: SoundTrigger[]; // Sound triggers for pre-rendered spells
}

// ============================================================================
// SPELL REGISTRY - Maps spell IDs to their dynamic implementations
// ============================================================================

const DYNAMIC_SPELLS: Record<number, new () => ISpellAnimation> = {
  909: Spell909,
  1005: Spell1005,
};

// ============================================================================
// PRE-RENDERED ANIMATION PLAYER
// ============================================================================

class PreRenderedAnimation extends Container {
  private textures: Texture[] = [];
  private sprite: Sprite;
  private currentFrame = 0;
  private stopped = false;
  private _onComplete?: () => void;
  private sounds: SoundTrigger[] = [];
  private triggeredSounds: Set<number> = new Set();
  private _playSound?: (soundId: string) => void;

  // Fade-out state (matching Dofus client behavior)
  // Dofus uses time-based fading: t = value / duration / FPS (15 FPS average)
  // Also applies a white tint during fade using color transform rb/gb/bb offsets
  private isFadingOut = false;
  private fadeOutComplete = false;
  private static readonly FADE_OUT_DURATION_MS = 1_000; // ~6 frames at 15 FPS
  private fadeOutElapsed = 0;

  // Color matrix filter for fade-to-white effect
  // Dofus uses color transforms {ra:60, rb:102, ...} which adds white while dimming
  private fadeFilter: ColorMatrixFilter | null = null;

  // The last frame with actual visible content (not empty)
  private lastVisibleFrame: number;
  // Texture to show during fade-out
  private fadeTexture: Texture;

  constructor(textures: Texture[], animation: Animation, scale: number, mainTimelineScale = 1.0) {
    super();
    this.textures = textures;

    // Use fadingFrame from manifest if available, otherwise fall back to heuristic
    if (animation.fadingFrame !== undefined) {
      this.lastVisibleFrame = animation.fadingFrame;
      console.log(`Animation has ${textures.length} frames, fading frame from manifest: ${this.lastVisibleFrame}`);
    } else {
      // Fallback: find the last non-empty frame (Dofus animations often have empty trailing frames)
      this.lastVisibleFrame = this.findLastVisibleFrame(textures);
      console.log(`Animation has ${textures.length} frames, detected last visible frame: ${this.lastVisibleFrame}`);
    }
    this.fadeTexture = textures[this.lastVisibleFrame];

    this.sprite = new Sprite(textures[0]);

    // Set anchor based on offset - use actual texture dimensions
    const tex = textures[0];
    if (tex && tex.width > 0 && tex.height > 0) {
      const anchorX = -animation.offsetX / tex.width;
      const anchorY = -animation.offsetY / tex.height;

      // Combined scale: supersample scale (1/6) * main timeline scale
      const combinedScale = (1 / scale) * mainTimelineScale;

      console.log(`PreRendered: tex=${tex.width}x${tex.height}, offset=(${animation.offsetX}, ${animation.offsetY}), anchor=(${anchorX.toFixed(3)}, ${anchorY.toFixed(3)}), supersample=1/${scale}, mainTimelineScale=${mainTimelineScale.toFixed(4)}, combinedScale=${combinedScale.toFixed(4)}`);
      this.sprite.anchor.set(anchorX, anchorY);
      this.sprite.scale.set(combinedScale);
    } else {
      this.sprite.scale.set((1 / scale) * mainTimelineScale);
    }

    this.addChild(this.sprite);
  }

  setSounds(sounds: SoundTrigger[], playSound: (soundId: string) => void): void {
    this.sounds = sounds;
    this._playSound = playSound;
  }

  setOnComplete(callback: () => void): void {
    this._onComplete = callback;
  }

  advance(): void {
    if (this.stopped || this.isFadingOut) return;

    this.currentFrame++;

    // Check for sound triggers
    for (const sound of this.sounds) {
      if (this.currentFrame >= sound.frame && !this.triggeredSounds.has(sound.frame)) {
        this.triggeredSounds.add(sound.frame);
        this._playSound?.(sound.soundId);
      }
    }

    // Stop at the last VISIBLE frame (not empty trailing frames)
    if (this.currentFrame > this.lastVisibleFrame) {
      this.currentFrame = this.lastVisibleFrame;
      this.stopped = true;
      // Start fade-out instead of immediately completing
      this.isFadingOut = true;
      this.fadeOutElapsed = 0;
      // Use the pre-calculated fade texture (last visible frame)
      this.sprite.texture = this.fadeTexture;
      console.log(`Animation done, fading from frame ${this.currentFrame} (${this.fadeTexture.width}x${this.fadeTexture.height})`);
      return;
    }
    this.sprite.texture = this.textures[this.currentFrame];
  }

  /**
   * Update fade-out animation (called once per render frame, not per animation frame)
   * Uses time-based fading like Dofus: alpha decreases + white tint increases
   *
   * Dofus color transform pattern:
   * - ra/ga/ba: percentage multiplier (0-100 = 0-1.0)
   * - rb/gb/bb: offset added to channel (0-255)
   *
   * During fade: {ra:60, rb:102, ga:60, gb:102, ba:60, bb:102}
   * This dims to 60% while adding 102 white offset = fade to white effect
   */
  updateFade(deltaMs: number): void {
    if (!this.isFadingOut || this.fadeOutComplete) return;

    this.fadeOutElapsed += deltaMs;

    // Calculate progress (0 to 1)
    const progress = Math.min(this.fadeOutElapsed / PreRenderedAnimation.FADE_OUT_DURATION_MS, 1);

    // Create filter on first call
    if (!this.fadeFilter) {
      this.fadeFilter = new ColorMatrixFilter();
      this.sprite.filters = [this.fadeFilter];
    }

    // Dofus-style color transform:
    // Multiplier: 1.0 -> 0.6 (ra/ga/ba: 100 -> 60)
    const mult = 1 - progress * 0.4;
    // Offset: 0 -> 102/255 = 0.4 (normalized for PixiJS)
    const offset = progress * 0.4;

    // ColorMatrixFilter matrix is 5x4 stored as 20 floats:
    // [R_r, R_g, R_b, R_a, R_offset,
    //  G_r, G_g, G_b, G_a, G_offset,
    //  B_r, B_g, B_b, B_a, B_offset,
    //  A_r, A_g, A_b, A_a, A_offset]
    // prettier-ignore
    this.fadeFilter.matrix = [
      mult, 0, 0, 0, offset,
      0, mult, 0, 0, offset,
      0, 0, mult, 0, offset,
      0, 0, 0, 1, 0
    ];

    // Alpha fade on the sprite itself
    this.sprite.alpha = 1 - progress;

    if (progress >= 1) {
      this.alpha = 0;
      this.fadeOutComplete = true;
      // Clean up filter
      this.sprite.filters = [];
      this.fadeFilter = null;
      console.log('Fade-out complete');
      this._onComplete?.();
    }
  }

  reset(): void {
    this.currentFrame = 0;
    this.stopped = false;
    this.isFadingOut = false;
    this.fadeOutComplete = false;
    this.fadeOutElapsed = 0;
    this.alpha = 1;
    this.sprite.alpha = 1;
    this.triggeredSounds.clear();
    this.sprite.texture = this.textures[0];
    // Clean up filter
    if (this.fadeFilter) {
      this.sprite.filters = [];
      this.fadeFilter = null;
    }
  }

  isComplete(): boolean {
    return this.fadeOutComplete;
  }

  /**
   * Find the last frame with actual visible content.
   * Dofus animations often have empty trailing frames after the stop() point.
   * We detect empty frames by checking if the texture has minimal dimensions.
   */
  private findLastVisibleFrame(textures: Texture[]): number {
    // Search backwards from the end to find the last non-empty frame
    for (let i = textures.length - 1; i >= 0; i--) {
      const tex = textures[i];
      // A frame is considered "visible" if it has reasonable dimensions
      // Empty frames typically have 0x0 or 1x1 dimensions
      if (tex && tex.width > 2 && tex.height > 2) {
        return i;
      }
    }
    // Fallback to last frame if all seem empty
    return textures.length - 1;
  }
}

// ============================================================================
// TEXTURE PROVIDER IMPLEMENTATION
// ============================================================================

class ManifestTextureProvider implements SpellTextureProvider {
  private textureMap: Map<string, Texture[]>;

  constructor(textureMap: Map<string, Texture[]>) {
    this.textureMap = textureMap;
  }

  getTexture(name: string): Texture {
    const frames = this.textureMap.get(name);
    return frames?.[0] ?? Texture.EMPTY;
  }

  getFrames(prefix: string): Texture[] {
    return this.textureMap.get(prefix) ?? [];
  }

  hasTexture(name: string): boolean {
    return this.textureMap.has(name);
  }
}

// ============================================================================
// BATTLEFIELD SIMULATION
// ============================================================================

// Dofus cell constants (from battlefield.ts)
const CELL_WIDTH = 53;
const CELL_HALF_WIDTH = 26.5;
const CELL_HALF_HEIGHT = 13.5;
const LEVEL_HEIGHT = 20;
const DEFAULT_MAP_WIDTH = 15;
const DEFAULT_GROUND_LEVEL = 7;

/**
 * Convert cell ID to pixel coordinates (same algorithm as Dofus)
 */
function getCellPosition(cellId: number, mapWidth: number, groundLevel: number): { x: number; y: number } {
  let loc14 = mapWidth - 1;
  let loc9 = -1;
  let loc10 = 0;
  let loc11 = 0;

  for (let id = 0; id <= cellId; id++) {
    if (loc9 === loc14) {
      loc9 = 0;
      loc10 += 1;
      if (loc11 === 0) {
        loc11 = CELL_HALF_WIDTH;
        loc14 -= 1;
      } else {
        loc11 = 0;
        loc14 += 1;
      }
    } else {
      loc9 += 1;
    }
  }

  const x = Math.floor(loc9 * CELL_WIDTH + loc11);
  const y = Math.floor(loc10 * CELL_HALF_HEIGHT - LEVEL_HEIGHT * (groundLevel - 7));

  return { x, y };
}

/**
 * Draw an isometric cell diamond
 */
function drawCell(graphics: Graphics, x: number, y: number, color: number, alpha = 0.3): void {
  graphics.moveTo(x, y - CELL_HALF_HEIGHT);
  graphics.lineTo(x + CELL_HALF_WIDTH, y);
  graphics.lineTo(x, y + CELL_HALF_HEIGHT);
  graphics.lineTo(x - CELL_HALF_WIDTH, y);
  graphics.closePath();
  graphics.fill({ color, alpha });
  graphics.stroke({ color, width: 1, alpha: 0.5 });
}

/**
 * Create a simple battlefield grid visualization
 */
function createBattlefield(mapWidth: number, cellCount: number): Graphics {
  const graphics = new Graphics();

  // Draw cells
  for (let cellId = 0; cellId < cellCount; cellId++) {
    const pos = getCellPosition(cellId, mapWidth, DEFAULT_GROUND_LEVEL);
    drawCell(graphics, pos.x, pos.y, 0x444444, 0.2);
  }

  return graphics;
}

/**
 * Create a fighter marker (circle with direction indicator)
 */
function createFighterMarker(color: number, label: string): Container {
  const container = new Container();

  // Circle
  const circle = new Graphics();
  circle.circle(0, 0, 15);
  circle.fill({ color, alpha: 0.8 });
  circle.stroke({ color: 0xffffff, width: 2 });
  container.addChild(circle);

  // Direction indicator (arrow pointing right)
  const arrow = new Graphics();
  arrow.moveTo(5, 0);
  arrow.lineTo(-3, -5);
  arrow.lineTo(-3, 5);
  arrow.closePath();
  arrow.fill({ color: 0xffffff });
  container.addChild(arrow);

  // Label (using graphics since Text requires font loading)
  // We'll just use the marker colors to distinguish

  return container;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const app = new Application();
  await app.init({
    width: 1000,
    height: 700,
    backgroundColor: 0x1a1a2e,
  });

  document.getElementById('app')!.appendChild(app.canvas);

  // Get spell ID from URL or use default
  const urlParams = new URLSearchParams(window.location.search);
  let spellId = parseInt(urlParams.get('spell') ?? '1001', 10);

  // Create spell selector UI
  const selector = document.getElementById('spell-selector') as HTMLSelectElement;
  if (selector) {
    selector.value = String(spellId);
    selector.addEventListener('change', () => {
      const newId = parseInt(selector.value, 10);
      window.location.search = `?spell=${newId}`;
    });
  }

  // Load spell
  const basePath = `/spell-anims/${spellId}`;
  const manifestPath = `${basePath}/manifest.json`;

  let manifest: Manifest;
  try {
    const response = await fetch(manifestPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json();
  } catch (e) {
    console.error(`Failed to load spell ${spellId}:`, e);
    return;
  }

  console.log(`Loaded spell ${spellId}:`, manifest);

  const animation = manifest.animations[0];
  const isDynamic = spellId in DYNAMIC_SPELLS;

  // Update mode indicator
  const modeEl = document.getElementById('mode');
  if (modeEl) {
    modeEl.textContent = isDynamic ? 'Dynamic (TypeScript)' : 'Pre-rendered';
    modeEl.style.color = isDynamic ? '#4caf50' : '#2196f3';
  }

  // Load textures
  const textureMap = new Map<string, Texture[]>();

  if (isDynamic) {
    // Load textures from ALL animations (some spells have multiple)
    for (const anim of manifest.animations) {
      // Load main animation frames
      if (anim.frames) {
        const textures: Texture[] = [];
        console.log(`Loading ${anim.frames.length} frames for ${anim.name}...`);
        for (const frame of anim.frames) {
          const framePath = `${basePath}/${frame.file}`;
          try {
            const texture = await Assets.load(framePath);
            textures.push(texture);
          } catch {
            textures.push(Texture.EMPTY);
          }
        }
        textureMap.set(anim.name, textures);
      }

      // Load child sprite textures
      if (anim.childSprites) {
        for (const childSprite of anim.childSprites) {
          // Skip if already loaded
          if (textureMap.has(childSprite.name)) continue;

          const textures: Texture[] = [];
          console.log(`Loading ${childSprite.frameCount} frames for ${childSprite.name}...`);

          for (let i = 0; i < childSprite.frameCount; i++) {
            const framePath = `${basePath}/${childSprite.name}_${i}.webp`;
            try {
              const texture = await Assets.load(framePath);
              textures.push(texture);
            } catch {
              textures.push(Texture.EMPTY);
            }
          }
          textureMap.set(childSprite.name, textures);
        }
      }
    }

    // Load library symbols (used via attachMovie in ActionScript)
    if (manifest.librarySymbols) {
      for (const libSymbol of manifest.librarySymbols) {
        // Skip if already loaded
        if (textureMap.has('lib_' + libSymbol.name)) continue;

        const textures: Texture[] = [];
        console.log(`Loading ${libSymbol.frameCount} frames for lib_${libSymbol.name}...`);

        for (const frame of libSymbol.frames) {
          const framePath = `${basePath}/${frame.file}`;
          try {
            const texture = await Assets.load(framePath);
            textures.push(texture);
          } catch {
            textures.push(Texture.EMPTY);
          }
        }
        textureMap.set('lib_' + libSymbol.name, textures);
      }
    }
  }

  // Create animation container
  let animContainer: Container;
  let currentAnimation: PreRenderedAnimation | ISpellAnimation;

  // Battlefield setup for dynamic spells
  const battlefieldContainer = new Container();
  // Use cells on the same row for proper horizontal spell testing
  // Row 8 (even row, no offset): cells 116-130 (15 cells)
  // Cell 120 is at column 4, Cell 125 is at column 9 (5 cells apart horizontally)
  const casterCellId = 120;
  const targetCellId = 125;
  const mapWidth = DEFAULT_MAP_WIDTH;
  // Cell count: mapWidth * mapHeight * 2 - mapWidth = 15 * 17 * 2 - 15 = 495
  const cellCount = 495;

  // Pre-calculate positions for centering (used by both branches and scale controls)
  const casterPos = getCellPosition(casterCellId, mapWidth, DEFAULT_GROUND_LEVEL);
  const targetPos = getCellPosition(targetCellId, mapWidth, DEFAULT_GROUND_LEVEL);

  // Calculate center point between caster and target for better framing
  const centerX = (casterPos.x + targetPos.x) / 2;
  const centerY = (casterPos.y + targetPos.y) / 2;

  // Calculate angle and distance
  const dx = targetPos.x - casterPos.x;
  const dy = targetPos.y - casterPos.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const distance = Math.sqrt(dx * dx + dy * dy);

  console.log(`Battlefield setup:`);
  console.log(`  Caster cell ${casterCellId}: (${casterPos.x}, ${casterPos.y})`);
  console.log(`  Target cell ${targetCellId}: (${targetPos.x}, ${targetPos.y})`);
  console.log(`  Center: (${centerX}, ${centerY})`);
  console.log(`  Angle: ${angle.toFixed(1)}°, Distance: ${distance.toFixed(1)}px`);

  if (isDynamic) {
    // Create battlefield visualization
    const battlefield = createBattlefield(mapWidth, cellCount);
    battlefieldContainer.addChild(battlefield);

    // Highlight caster and target cells
    const highlightGraphics = new Graphics();
    drawCell(highlightGraphics, casterPos.x, casterPos.y, 0x00ff00, 0.5); // Green for caster
    drawCell(highlightGraphics, targetPos.x, targetPos.y, 0xff0000, 0.5); // Red for target
    battlefieldContainer.addChild(highlightGraphics);

    // Add fighter markers
    const casterMarker = createFighterMarker(0x00ff00, 'C');
    casterMarker.position.set(casterPos.x, casterPos.y);
    battlefieldContainer.addChild(casterMarker);

    const targetMarker = createFighterMarker(0xff0000, 'T');
    targetMarker.position.set(targetPos.x, targetPos.y);
    battlefieldContainer.addChild(targetMarker);

    // Create dynamic spell instance
    const SpellClass = DYNAMIC_SPELLS[spellId];
    const spell = new SpellClass();

    // Create real context with battlefield data
    const context: SpellContext = {
      cellFrom: { cellId: casterCellId, x: casterPos.x, y: casterPos.y, groundLevel: DEFAULT_GROUND_LEVEL },
      cellTo: { cellId: targetCellId, x: targetPos.x, y: targetPos.y, groundLevel: DEFAULT_GROUND_LEVEL },
      angle: angle,
      distance: distance,
      level: 3, // Test with level 3 for more particles
      caster: { id: 1, name: 'Caster', team: 0 },
      casterFacingRight: dx >= 0,
      parentFrame: 0,
      instanceIndex: 0,
      isCritical: false,
    };

    // Create callbacks
    const callbacks: SpellCallbacks = {
      playSound: (soundId: string) => {
        console.log(`Sound: ${soundId}`);
        soundManager.play(soundId);
      },
      onComplete: () => console.log('Animation complete!'),
      onHit: () => console.log('Hit!'),
      onEvent: (name: string, data?: unknown) => console.log(`Event: ${name}`, data),
    };

    // Initialize spell
    const textureProvider = new ManifestTextureProvider(textureMap);
    spell.init(context, callbacks, textureProvider);

    // Position spell container at caster position (spell handles internal positioning)
    spell.container.position.set(casterPos.x, casterPos.y);
    battlefieldContainer.addChild(spell.container);

    // Debug: Draw line of sight from caster to target (at cell center)
    const debugLine = new Graphics();
    debugLine.moveTo(casterPos.x, casterPos.y);
    debugLine.lineTo(targetPos.x, targetPos.y);
    debugLine.stroke({ color: 0xffff00, width: 2, alpha: 0.8 });
    battlefieldContainer.addChild(debugLine);

    currentAnimation = spell;
    animContainer = battlefieldContainer;
  } else {
    // Pre-rendered spells also show on battlefield
    const battlefield = createBattlefield(mapWidth, cellCount);
    battlefieldContainer.addChild(battlefield);

    // Highlight caster and target cells
    const highlightGraphics = new Graphics();
    drawCell(highlightGraphics, casterPos.x, casterPos.y, 0x00ff00, 0.5);
    drawCell(highlightGraphics, targetPos.x, targetPos.y, 0xff0000, 0.5);
    battlefieldContainer.addChild(highlightGraphics);

    // Add fighter markers
    const casterMarker = createFighterMarker(0x00ff00, 'C');
    casterMarker.position.set(casterPos.x, casterPos.y);
    battlefieldContainer.addChild(casterMarker);

    const targetMarker = createFighterMarker(0xff0000, 'T');
    targetMarker.position.set(targetPos.x, targetPos.y);
    battlefieldContainer.addChild(targetMarker);

    // Debug line
    const debugLine = new Graphics();
    debugLine.moveTo(casterPos.x, casterPos.y);
    debugLine.lineTo(targetPos.x, targetPos.y);
    debugLine.stroke({ color: 0xffff00, width: 2, alpha: 0.8 });
    battlefieldContainer.addChild(debugLine);

    // Load pre-rendered frames
    const textures: Texture[] = [];
    const frameFiles = animation.frames || [];
    console.log(`Loading ${frameFiles.length} pre-rendered frames...`);

    for (const frame of frameFiles) {
      const framePath = `${basePath}/${frame.file}`;
      try {
        const texture = await Assets.load(framePath);
        textures.push(texture);
      } catch {
        textures.push(Texture.EMPTY);
      }
    }

    // Preload sounds if manifest has them
    if (manifest.sounds && manifest.sounds.length > 0) {
      const soundIds = manifest.sounds.map(s => s.soundId);
      console.log(`Preloading ${soundIds.length} sounds for pre-rendered spell...`);
      await soundManager.preload(soundIds);
    }

    // Apply both supersample scale (6x) and main timeline scale from manifest
    const mainTimelineScale = manifest.mainTimelineScale ?? 1.0;
    const preRendered = new PreRenderedAnimation(textures, animation, manifest.scale, mainTimelineScale);
    preRendered.setOnComplete(() => console.log('Pre-rendered animation complete!'));

    // Set up sounds for pre-rendered animation
    if (manifest.sounds && manifest.sounds.length > 0) {
      preRendered.setSounds(manifest.sounds, (soundId) => soundManager.play(soundId));
    }

    // Position at target cell (spell's anchor handles the visual offset)
    preRendered.position.set(targetPos.x, targetPos.y);
    battlefieldContainer.addChild(preRendered);

    currentAnimation = preRendered;
    animContainer = battlefieldContainer;
  }

  // Position and scale animation
  let currentScale = 1.0;

  // Helper to center the view on the midpoint between caster and target
  const updateContainerTransform = () => {
    animContainer.scale.set(currentScale);
    // Use pivot to set the rotation/scale center point
    animContainer.pivot.set(centerX, centerY);
    // Position container so pivot point is at screen center
    animContainer.position.set(app.screen.width / 2, app.screen.height / 2);
  };

  // Apply initial transform
  updateContainerTransform();

  app.stage.addChild(animContainer);

  // Scale controls
  const scaleValueEl = document.getElementById('scale-value');
  const updateScaleDisplay = () => {
    if (scaleValueEl) {
      scaleValueEl.textContent = `${currentScale.toFixed(1)}x`;
    }
  };

  const scaleDownBtn = document.getElementById('scale-down');
  const scaleUpBtn = document.getElementById('scale-up');

  if (scaleDownBtn) {
    scaleDownBtn.addEventListener('click', () => {
      currentScale = Math.max(0.1, currentScale - 0.25);
      updateContainerTransform();
      updateScaleDisplay();
    });
  }

  if (scaleUpBtn) {
    scaleUpBtn.addEventListener('click', () => {
      currentScale = Math.min(5, currentScale + 0.25);
      updateContainerTransform();
      updateScaleDisplay();
    });
  }

  // Speed controls
  let playbackSpeed = 1.0;
  const speedValueEl = document.getElementById('speed-value');
  const updateSpeedDisplay = () => {
    if (speedValueEl) speedValueEl.textContent = `${playbackSpeed.toFixed(1)}x`;
  };

  const speedDownBtn = document.getElementById('speed-down');
  const speedUpBtn = document.getElementById('speed-up');

  if (speedDownBtn) {
    speedDownBtn.addEventListener('click', () => {
      playbackSpeed = Math.max(0.1, playbackSpeed - 0.1);
      updateSpeedDisplay();
    });
  }

  if (speedUpBtn) {
    speedUpBtn.addEventListener('click', () => {
      playbackSpeed = Math.min(3, playbackSpeed + 0.1);
      updateSpeedDisplay();
    });
  }

  // Animation loop
  let frameAccumulator = 0;
  const frameTime = 1000 / manifest.fps;
  let lastTime = performance.now();

  app.ticker.add(() => {
    const now = performance.now();
    const delta = now - lastTime;
    lastTime = now;

    frameAccumulator += delta * playbackSpeed;

    while (frameAccumulator >= frameTime) {
      if (isDynamic) {
        (currentAnimation as ISpellAnimation).update(frameTime, 0);
      } else {
        (currentAnimation as PreRenderedAnimation).advance();
      }
      frameAccumulator -= frameTime;
    }

    // Update fade-out animation (once per render frame, time-based like Dofus)
    if (!isDynamic) {
      (currentAnimation as PreRenderedAnimation).updateFade(delta * playbackSpeed);
    }
  });

  // Replay button
  const replayBtn = document.getElementById('replay');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      if ('reset' in currentAnimation && typeof currentAnimation.reset === 'function') {
        currentAnimation.reset();
      }
      frameAccumulator = 0;
      lastTime = performance.now();
    });
  }

  console.log(`Spell ${spellId} loaded - Mode: ${isDynamic ? 'Dynamic' : 'Pre-rendered'}`);
}

main().catch(console.error);
