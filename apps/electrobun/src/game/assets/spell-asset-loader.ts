import {
  readSpellExtras,
  type SpellExtras,
  type SpellExtrasAnimation,
} from "@dofus/dofasset-format";
import type {
  SpellAnimationInfo,
  SpellTextureProvider,
} from "@dofus/spell-runtime";
import { Texture } from "pixi.js";

import type {
  SpellAnimation,
  SpellVelloRenderer,
} from "@/game/render/spell-vello-renderer";
import { createLogger } from "@/utils/logger";

const log = createLogger("SpellAssetLoader");

export interface SpellSoundTrigger {
  frame: number;
  soundId: string;
}

export interface SpellMeta {
  id: number;
  fps: number;
  mainTimelineScale: number;
  requiresTypeScript: boolean;
  sounds: SpellSoundTrigger[];
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
 * Shape callers still know as `SpellManifest`. Built from the Extras section
 * baked into the .dofasset binary at compile time — no more sidecar JSON
 * fetch.
 */
export interface SpellManifest {
  version: number;
  spriteId: string;
  animations: Record<string, SpellExtrasAnimation>;
  spell: SpellMeta;
}

export interface LoadedSpell {
  manifest: SpellManifest;
  textures: SpellTextureProvider;
}

class VelloSpellTextureProvider implements SpellTextureProvider {
  private readonly anims = new Map<string, SpellAnimation | null>();

  constructor(
    private readonly spellId: number,
    private readonly manifest: SpellManifest,
    private readonly vello: SpellVelloRenderer,
    private readonly resolution: number
  ) {}

  getTexture(name: string): Texture {
    const idx = name.lastIndexOf("_");
    if (idx > 0) {
      const animName = name.slice(0, idx);
      const frameIdx = Number.parseInt(name.slice(idx + 1), 10);
      if (!Number.isNaN(frameIdx)) {
        const frames = this.getFrames(animName);
        const tex = frames[frameIdx];
        if (tex) {
          return tex;
        }
      }
    }
    return this.getFrames("anim1")[0] ?? Texture.EMPTY;
  }

  getFrames(prefix: string): Texture[] {
    const cached = this.anims.get(prefix);
    if (cached !== undefined) {
      return cached?.frames ?? [];
    }
    if (!(prefix in this.manifest.animations)) {
      this.anims.set(prefix, null);
      return [];
    }
    const anim = this.vello.buildAnimation(
      this.spellId,
      prefix,
      this.resolution
    );
    this.anims.set(prefix, anim);
    return anim?.frames ?? [];
  }

  hasTexture(name: string): boolean {
    const idx = name.lastIndexOf("_");
    if (idx <= 0) {
      return false;
    }
    const animName = name.slice(0, idx);
    return animName in this.manifest.animations;
  }

  getAnimationInfo(name: string): SpellAnimationInfo | null {
    const cached = this.anims.get(name);
    const anim =
      cached !== undefined
        ? cached
        : (this.getFrames(name), this.anims.get(name) ?? null);
    if (!anim) {
      return null;
    }
    return {
      frameWidth: anim.frameWidth,
      frameHeight: anim.frameHeight,
      anchorPxX: anim.anchorPxX,
      anchorPxY: anim.anchorPxY,
    };
  }

  destroy(): void {
    for (const anim of this.anims.values()) {
      if (!anim) {
        continue;
      }
      for (const tex of anim.frames) {
        tex.destroy(false);
      }
    }
    this.anims.clear();
  }
}

/**
 * Spell asset loader backed by `.dofasset` binaries compiled by the
 * asset-pipeline (`pipeline compile spells`). Sound triggers, lifecycle
 * frames, requiresTypeScript and per-animation canvas dims live in the
 * binary's Extras section — no sidecar manifest.json is fetched at runtime.
 */
export class SpellAssetLoader {
  private vello: SpellVelloRenderer | null = null;
  private currentResolution = 1;
  private readonly loaded = new Map<number, LoadedSpell>();
  private readonly pending = new Map<number, Promise<LoadedSpell | null>>();
  private readonly manifests = new Map<number, SpellManifest | null>();

  setResolution(resolution: number): void {
    if (this.currentResolution === resolution) {
      return;
    }
    this.currentResolution = resolution;
    this.vello?.clearAnimationCache();
    for (const loaded of this.loaded.values()) {
      (loaded.textures as VelloSpellTextureProvider).destroy();
    }
    this.loaded.clear();
  }

  setVelloRenderer(vello: SpellVelloRenderer): void {
    this.vello = vello;
  }

  async loadSpell(spellId: number): Promise<LoadedSpell | null> {
    // visualGfxId === 0 means "no spell-specific visual" (StarLoco's
    // sorts.sprite=0 — common for glyphs / buffs / area effects where
    // the canonical client just plays the cast pose + shows the
    // server-driven GameZoneData overlay). Don't fetch /spells/0.dofasset
    // for these — that file is the close-combat punch placeholder, not
    // a fallback, and trying to parse it pollutes the spell-cast
    // pipeline with an "Uncaught (in promise)" rejection.
    if (spellId <= 0) {
      return null;
    }
    const cached = this.loaded.get(spellId);
    if (cached) {
      return cached;
    }
    const pending = this.pending.get(spellId);
    if (pending) {
      return pending;
    }
    const promise = this.doLoad(spellId);
    this.pending.set(spellId, promise);
    try {
      const result = await promise;
      if (result) {
        this.loaded.set(spellId, result);
      }
      return result;
    } catch (err) {
      // Never let a load error escape the loader — the cast machine
      // expects a Promise<LoadedSpell|null>, not a rejected promise,
      // and an unhandled rejection blocks every subsequent cast.
      log.warn(`spell ${spellId}: dofasset load threw — ${String(err)}`);
      this.manifests.set(spellId, null);
      return null;
    } finally {
      this.pending.delete(spellId);
    }
  }

  async preload(spellIds: number[]): Promise<void> {
    await Promise.all(spellIds.map((id) => this.loadSpell(id)));
  }

  getManifestSync(spellId: number): SpellManifest | null {
    return this.manifests.get(spellId) ?? null;
  }

  destroy(): void {
    for (const loaded of this.loaded.values()) {
      (loaded.textures as VelloSpellTextureProvider).destroy();
    }
    this.loaded.clear();
    this.manifests.clear();
    this.vello?.clearAnimationCache();
  }

  private async doLoad(spellId: number): Promise<LoadedSpell | null> {
    const vello = this.vello;
    if (!vello) {
      log.warn(
        `spell ${spellId}: vello renderer not initialized — caller forgot setVelloRenderer()`
      );
      return null;
    }

    const assetOk = await vello.loadAsset(spellId);
    if (!assetOk) {
      log.warn(
        `spell ${spellId}: dofasset load failed (404 or vello.loadAsset rejected); spell will render nothing`
      );
      this.manifests.set(spellId, null);
      return null;
    }

    const bytes = vello.getAssetBytes(spellId);
    if (!bytes) {
      log.warn(
        `spell ${spellId}: dofasset bytes missing after successful loadAsset — vello cache invariant broken`
      );
      this.manifests.set(spellId, null);
      return null;
    }

    // Validate magic bytes before handing to readSpellExtras. Vite's
    // dev server SPA fallback returns index.html (text/html) for
    // unknown paths; arrayBuffer of an HTML response starts with `<`
    // (0x3c) and trips assertMagic with an opaque "bad magic" error
    // that bubbles up as an Uncaught (in promise). Surface it here
    // as a clear diagnostic and bail gracefully.
    if (
      bytes.length < 4 ||
      bytes[0] !== 0x44 ||
      bytes[1] !== 0x41 ||
      bytes[2] !== 0x53 ||
      bytes[3] !== 0x46
    ) {
      const head =
        bytes.length >= 4
          ? `0x${bytes[0]?.toString(16).padStart(2, "0")}${bytes[1]?.toString(16).padStart(2, "0")}${bytes[2]?.toString(16).padStart(2, "0")}${bytes[3]?.toString(16).padStart(2, "0")}`
          : `len=${bytes.length}`;
      log.warn(
        `spell ${spellId}: not a .dofasset (magic=${head}) — likely a 404 or text/html fallback from the dev server`
      );
      this.manifests.set(spellId, null);
      return null;
    }

    let extras: ReturnType<typeof readSpellExtras>;
    try {
      extras = readSpellExtras(bytes);
    } catch (err) {
      log.warn(
        `spell ${spellId}: readSpellExtras threw — ${String(err)} (corrupt .dofasset; re-run \`bun run tools/asset-pipeline/src/cli.ts compile spells\`)`
      );
      this.manifests.set(spellId, null);
      return null;
    }
    if (!extras) {
      log.warn(
        `spell ${spellId}: readSpellExtras returned null — Extras section missing or malformed in .dofasset (re-compile the spell asset)`
      );
      this.manifests.set(spellId, null);
      return null;
    }

    const manifest = buildManifestFromExtras(spellId, extras);
    this.manifests.set(spellId, manifest);
    const textures = new VelloSpellTextureProvider(
      spellId,
      manifest,
      vello,
      this.currentResolution
    );
    return { manifest, textures };
  }
}

function buildManifestFromExtras(
  spellId: number,
  extras: SpellExtras
): SpellManifest {
  return {
    version: 1,
    spriteId: String(spellId),
    animations: extras.animations ?? {},
    spell: {
      id: spellId,
      fps: extras.fps,
      mainTimelineScale: extras.mainTimelineScale,
      requiresTypeScript: extras.requiresTypeScript,
      sounds: extras.sounds,
      animationMeta: extras.animationMeta,
    },
  };
}
