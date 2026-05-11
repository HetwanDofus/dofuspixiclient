import type {
  SpellAnimationInfo,
  SpellTextureProvider,
} from "@dofus/spell-runtime";
import { Texture } from "pixi.js";

import type { SpellVelloRenderer } from "@/game/render/spell-vello-renderer";
import { swfBundleFrameRate } from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("SpellAssetLoader");

export interface SpellSoundTrigger {
  frame: number;
  soundId: string;
}

/**
 * Per-spell metadata. With the live-tick architecture (PreRenderedSpell
 * runs an `AvmRenderer` per cast, not a pre-baked strip), almost
 * everything the legacy dofasset Extras carried (`stopFrame`,
 * `fadingFrame`, `sounds`, `animationMeta`) is now derived from AS2
 * itself: the canonical SWF + AVM1 are the single source of truth.
 *
 * What stays: `id` and `fps` (so the JS update loop knows the cast's
 * native frame rate). `requiresTypeScript` always `false`; the per-
 * spell TS handlers under `game/spells/spell-*.ts` are obsolete.
 */
export interface SpellMeta {
  id: number;
  fps: number;
  mainTimelineScale: number;
  /** Always `false` now — kept for legacy callers. */
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

export interface SpellManifest {
  version: number;
  spriteId: string;
  animations: Record<string, { fps: number }>;
  spell: SpellMeta;
}

/**
 * `SpellTextureProvider` is part of the spell-runtime's `init()`
 * signature, but the live-tick path doesn't slice strips into Pixi
 * textures — `AvmRenderer` writes pixels into the cast's stable wgpu
 * texture each tick. This provider is a stub so the interface still
 * type-checks; if a future RuntimeSpell port wants strip frames it
 * can subclass and implement.
 */
class EmptySpellTextureProvider implements SpellTextureProvider {
  getTexture(): Texture {
    return Texture.EMPTY;
  }
  getFrames(): Texture[] {
    return [];
  }
  hasTexture(): boolean {
    return false;
  }
  getAnimationInfo(): SpellAnimationInfo | null {
    return null;
  }
  destroy(): void {}
}

/**
 * Live-tick spell handle. The asset loader owns SWF lifecycle (load
 * once per spell id, dispose on scene exit) and exposes the fields a
 * fresh `PreRenderedSpell` cast needs to allocate its own AVM1 instance:
 *
 *   - `bundleName` — `loadSwfBundle` key, passed to `createSwfSpellInstance`.
 *   - `resolution` — current zoom; controls the pre-allocated GPU
 *     output texture size.
 *   - `fps` — spell SWF frame rate; drives the JS update accumulator
 *     so AVM1 advances at its native cadence regardless of Pixi ticker
 *     fps.
 *
 * `manifest` is kept for legacy diagnostics; `textures` is a stub.
 */
export interface LoadedSpell {
  manifest: SpellManifest;
  textures: SpellTextureProvider;
  bundleName: string;
  resolution: number;
  fps: number;
}

/**
 * Spell asset loader, SWF-only. Each spell's `.swf` is parsed by Vello
 * once per scene; per-cast state lives in `PreRenderedSpell` (one
 * `AvmRenderer` instance per cast). No dofasset, no per-spell TS
 * handlers, no pre-bake.
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
    // The bundle is resolution-independent; only `LoadedSpell.resolution`
    // is stale. Repopulate it for already-loaded spells so the next
    // cast allocates its output texture at the new zoom.
    for (const loaded of this.loaded.values()) {
      loaded.resolution = resolution;
    }
  }

  setVelloRenderer(vello: SpellVelloRenderer): void {
    this.vello = vello;
  }

  async loadSpell(spellId: number): Promise<LoadedSpell | null> {
    // visualGfxId === 0 means "no spell-specific visual" (StarLoco's
    // sorts.sprite=0 — common for glyphs / buffs / area effects where
    // the canonical client just plays the cast pose + shows the
    // server-driven GameZoneData overlay). Don't fetch /spells/0.swf
    // for these — that file is the close-combat punch placeholder.
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
      log.warn(`spell ${spellId}: SWF load threw — ${String(err)}`);
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
    this.loaded.clear();
    this.manifests.clear();
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
        `spell ${spellId}: SWF bundle load failed; spell will render nothing`
      );
      this.manifests.set(spellId, null);
      return null;
    }

    const bundleName = vello.bundleNameFor(spellId);
    if (!bundleName) {
      log.warn(`spell ${spellId}: bundle name missing after successful load`);
      this.manifests.set(spellId, null);
      return null;
    }

    // `swfBundleFrameRate` reads the SWF header — cheap, no GPU work.
    // Falls back to 24 (the dofasset-era default) when the bundle has
    // no explicit rate, which matches the old PreRenderedSpell.DEFAULT_FPS.
    const fps = swfBundleFrameRate(bundleName) || 24;

    const manifest: SpellManifest = {
      version: 2,
      spriteId: String(spellId),
      animations: { anim1: { fps } },
      spell: {
        id: spellId,
        fps,
        mainTimelineScale: 1,
        requiresTypeScript: false,
        sounds: [],
        animationMeta: {},
      },
    };
    this.manifests.set(spellId, manifest);
    return {
      manifest,
      textures: new EmptySpellTextureProvider(),
      bundleName,
      resolution: this.currentResolution,
      fps,
    };
  }
}
