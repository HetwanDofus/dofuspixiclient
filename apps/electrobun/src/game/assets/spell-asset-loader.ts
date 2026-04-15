import type { SpellTextureProvider } from "@dofus/spell-runtime";
import { Texture } from "pixi.js";

/**
 * Sound trigger from the original fight-exporter manifest.
 */
export interface SpellSoundTrigger {
  frame: number;
  soundId: string;
}

/**
 * Spell-specific metadata merged into the manifest by merge-spell-manifests.ts.
 */
export interface SpellMeta {
  id: number;
  fps: number;
  mainTimelineScale: number;
  requiresTypeScript: boolean;
  sounds: SpellSoundTrigger[];
  librarySymbols: unknown[];
  animationMeta: Record<
    string,
    {
      stopFrame?: number;
      fadingFrame?: number;
      isComposite?: boolean;
      hasMorphShapes?: boolean;
    }
  >;
}

/**
 * Per-animation entry in the combined spell manifest.
 */
interface ManifestAnimationEntry {
  file: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  fps: number;
}

/**
 * Combined manifest format.
 */
export interface SpellManifest {
  version: number;
  spriteId: string;
  animations: Record<string, ManifestAnimationEntry>;
  spell: SpellMeta;
}

/**
 * Loaded spell asset bundle: manifest + texture provider ready for ISpellAnimation.
 */
export interface LoadedSpell {
  manifest: SpellManifest;
  textures: SpellTextureProvider;
}

/**
 * Empty texture provider — every lookup returns `Texture.EMPTY`.
 * Used while the dofasset spell pipeline is being built (see below).
 */
class EmptyTextureProvider implements SpellTextureProvider {
  getTexture(_name: string): Texture {
    return Texture.EMPTY;
  }
  getFrames(_prefix: string): Texture[] {
    return [];
  }
  hasTexture(_name: string): boolean {
    return false;
  }
}

/**
 * Spell asset loader — stub.
 *
 * The original implementation loaded `atlas.svg` rasterizations through a
 * custom Pixi SVG parser. Both the SVG loader and its caller were the last
 * SVG-backed code in the app. They were deleted as part of the dofasset
 * migration (see project memory `dofasset is the asset format`).
 *
 * Spells do not yet have dofasset equivalents — see
 * `src/lib/spells/README.md`. Until they do, this loader returns an empty
 * texture provider so the fight system keeps running; spells will simply
 * play without visible effects. The cast result still triggers (signalHit +
 * complete) so damage, turns, and fight flow are unaffected.
 *
 * Once spell dofassets land (as `.dofasset` files under
 * `/assets/spritesheets/spells/{id}/`), replace the body of `doLoadSpell`
 * below with Vello-backed loads mirroring the tile pipeline in
 * `render/atlas-loader.ts`.
 */
export class SpellAssetLoader {
  private readonly textures = new EmptyTextureProvider();
  private currentResolution = 1;

  setResolution(resolution: number): void {
    this.currentResolution = resolution;
  }

  /**
   * Returns null — no spell asset pipeline is wired yet. The spell runtime
   * treats this as "no visible animation" and proceeds with its lifecycle
   * callbacks (signalHit / complete), which keeps fight correct.
   */
  async loadSpell(_spellId: number): Promise<LoadedSpell | null> {
    // Read currentResolution so biome/tsc recognise the field as used when
    // the body becomes non-trivial. No-op at the moment.
    void this.currentResolution;
    return null;
  }

  async preload(_spellIds: number[]): Promise<void> {
    return;
  }

  getManifestSync(_spellId: number): SpellManifest | null {
    return null;
  }

  destroy(): void {
    // No cached state yet.
  }

  /** Shared empty provider — exported for tests and future callers. */
  getTextures(): SpellTextureProvider {
    return this.textures;
  }
}
