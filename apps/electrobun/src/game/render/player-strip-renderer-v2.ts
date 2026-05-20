/**
 * Path B PlayerStripRendererV2 — band-mesh + accessory-sprite model.
 *
 * Same public surface as `PlayerStripRenderer` (V1) but the per-bot
 * container holds:
 *   - N `BodyBandMesh`es, one per Z-ordered slice of the body.
 *   - M accessory `Sprite`s, one per equipped slot.
 *
 * Body bands are baked once per `(class, anim, dir, flipped, band)`
 * and shared across every bot of the same class via `CharacterCache`.
 * Per-bot tint comes from a shader uniform — bots don't allocate
 * their own body strips. Accessory strips are similarly shared per
 * `(accBundle, accExport, slot, animType, dir, side)`. Mount affines
 * are CPU tables shared per `(bundle, anim, dir, flipped)`.
 *
 * Live battlefield still uses V1 by default; the cut-over is a
 * one-line swap in `battlefield-scene.ts` when validation lands.
 * Step 10 stress test targets V2 directly.
 *
 * Public API mirrors V1 so callers can swap implementations.
 */

import { Container, Matrix, Sprite, type Renderer as PixiRenderer } from "pixi.js";

import type { CharacterAnimation } from "@/game/assets/character-sprite";
import type { ActivePlayer } from "@/game/scene/player/types";
import {
  BodyBandColourZones,
  BodyBandMesh,
} from "@/game/render/body-band-shader";
import {
  type AccessoryStrip,
  type BodyAtlas,
  type CharacterCacheStats,
  getCharacterCache,
  MAX_SLOT,
  type MountTransforms,
} from "@/game/render/character-cache";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerStripRendererV2");

export type DirSuffix = "R" | "L" | "F" | "B" | "S";

export type PlayerStripSlot =
  | "main"
  | "mount-back"
  | "mount-rider"
  | "mount-front";

const SLOT_Z_INDEX: Record<PlayerStripSlot, number> = {
  "mount-back": -2,
  "mount-rider": -1,
  main: 0,
  "mount-front": 1,
};

interface AccessoryHook {
  sprite: Sprite;
  strip: AccessoryStrip | null;
  slot: number;
}

interface BandHook {
  bandIndex: number;
  mesh: BodyBandMesh | null;
}

interface PendingAnim {
  /** The anim key this staging is for. Stale-skip predicate matches against it. */
  key: string;
  animation: CharacterAnimation;
  animName: string;
  dir: DirSuffix;
  flipped: boolean;
  /**
   * The shared atlas covering EVERY band of this anim. Filled in by
   * the body-acquire callback; `undefined` while pending, `null` on
   * bake failure. Commit fires when this AND every required
   * accessory slot has reported.
   */
  atlas?: BodyAtlas | null;
  atlasArrived: boolean;
  /** Equipped slot → resolved AccessoryStrip (or null on bake failure). */
  accStrips: Map<number, AccessoryStrip | null>;
  /** Equipped slot ids — also serves as the expected accStrips key set. */
  accSlots: number[];
  /** Original accessory ref order so we can rebuild AccessoryHook order. */
  accessoryRefs: CharacterAnimation["accessories"];
  /** Sorted slot-depth list copied off the band info — drives Z order. */
  slotZ: Map<number, number>;
  mounts: MountTransforms | null;
  /**
   * Caller-side readiness signal. Resolves `true` on commit (strips
   * live and rendering); resolves `false` when superseded by a later
   * `applyAnimation` call (movement / AI should bail and re-issue
   * against the latest anim instead of acting on a stale strip).
   */
  resolve: (committed: boolean) => void;
  readyPromise: Promise<boolean>;
}

interface SlotStateV2 {
  /** Per-slot Pixi container under `player.container`. */
  root: Container;
  /**
   * Invisible (`renderable=false`) Sprite that tracks the band-0
   * strip's texture + anchor. Used by the picking layer for AABB +
   * alpha-test hovers — V2's actual visible content is Mesh+Sprite
   * mix that the picker doesn't grok, but the bounds match the
   * legacy `Sprite` exactly so picking behaves identically.
   */
  hitSprite: Sprite;
  /** Per-bot colour zone uniforms shared across all bands. */
  zones: BodyBandColourZones;
  /** Currently-live atlas (refcounted; null until the first commit). */
  atlas: BodyAtlas | null;
  /** Band meshes in Z-order — LIVE, rendering right now. */
  bands: BandHook[];
  /** Equipped accessory sprites keyed by slot id (0..MAX_SLOT-1) — LIVE. */
  accessories: Map<number, AccessoryHook>;
  /** CPU mount-transform table for the active anim. */
  mounts: MountTransforms | null;
  /** Slot id → Z order between bands. Updated when band info loads. */
  slotZ: Map<number, number>;
  /** Anim key currently INSTALLED (the visible bands). */
  currentAnimKey: string;
  /** Anim key most recently REQUESTED. Stale-skip predicate compares. */
  requestedAnimKey: string;
  /**
   * Path B staging buffer for the next anim. Filled in by the
   * acquire callbacks; commit fires atomically once every entry is
   * present so the visible body never half-swaps. `null` while no
   * change is pending — the live bands keep rendering as-is.
   */
  pendingAnim: PendingAnim | null;
  /** Last applyAnimation args — kept for resolution-change replay. */
  lastAnimation: CharacterAnimation | null;
  lastAnimName: string;
  lastDir: DirSuffix;
  lastFlipped: boolean;
  player: ActivePlayer | null;
}

function makeAnimKey(
  animation: CharacterAnimation,
  animName: string,
  dir: DirSuffix,
  flipped: boolean,
): string {
  // `look` is intentionally NOT in the key — body bake is per-class
  // shared across all looks; per-bot colour comes from the shader
  // uniform group. This is the whole point of Path B.
  return `${animation.bundle}|${animName}|${dir}|${flipped ? "f" : "u"}`;
}

export class PlayerStripRendererV2 {
  private states = new Map<number, Map<PlayerStripSlot, SlotStateV2>>();
  private resolution: number;
  private cache = getCharacterCache();

  constructor(_pixiRenderer: PixiRenderer, resolution = 3) {
    this.resolution = Math.max(1, resolution);
  }

  setResolution(res: number): void {
    this.resolution = Math.max(1, res);
  }

  getStats(): { players: number; slots: number; cache: CharacterCacheStats } {
    let slots = 0;
    for (const m of this.states.values()) slots += m.size;
    return {
      players: this.states.size,
      slots,
      cache: this.cache.getStats(),
    };
  }

  /**
   * True once the slot's first applyAnimation has fully committed —
   * every band + accessory landed and the bot's container is visible.
   * Path B promises commit atomically, so this stays true through
   * subsequent anim swaps (the live anim keeps rendering while a new
   * one stages). Callers gating an action (movement, AI, click) on
   * readiness should `await stripRenderer.applyAnimation(...)`
   * instead — the Promise resolves exactly when the requested anim
   * is on screen.
   */
  isSlotReady(playerId: number, slot: PlayerStripSlot = "main"): boolean {
    const st = this.states.get(playerId)?.get(slot);
    if (!st) return false;
    return st.currentAnimKey !== "" && st.currentAnimKey !== "<retired>";
  }

  /** Picking layer adapter — returns the slot's hit-test Sprite. */
  getSlotSprite(
    playerId: number,
    slot: PlayerStripSlot = "main",
  ): Sprite | null {
    const st = this.states.get(playerId)?.get(slot);
    if (!st) return null;
    // Honor the V1 contract: only return a sprite once a strip has
    // actually landed. Callers (picking) treat null as "not yet
    // pickable" and gracefully fall through to ground-clicks.
    if (!st.atlas || !st.hitSprite.texture) return null;
    return st.hitSprite;
  }

  getSlotContainer(
    playerId: number,
    slot: PlayerStripSlot = "main",
  ): Container | null {
    return this.states.get(playerId)?.get(slot)?.root ?? null;
  }

  attach(player: ActivePlayer): void {
    if (this.states.has(player.id)) return;
    const slots = new Map<PlayerStripSlot, SlotStateV2>();
    slots.set("main", this.createSlot(player, "main"));
    this.states.set(player.id, slots);
  }

  ensureSlot(player: ActivePlayer, slot: PlayerStripSlot): void {
    const slots = this.states.get(player.id);
    if (!slots) {
      log.warn(`ensureSlot: player ${player.id} not attached`);
      return;
    }
    if (!slots.has(slot)) slots.set(slot, this.createSlot(player, slot));
  }

  removeSlot(player: ActivePlayer, slot: PlayerStripSlot): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    const st = slots.get(slot);
    if (!st) return;
    this.retireSlotState(st);
    slots.delete(slot);
  }

  setSlotVisible(
    player: ActivePlayer,
    slot: PlayerStripSlot,
    visible: boolean,
  ): void {
    const st = this.states.get(player.id)?.get(slot);
    if (st) st.root.visible = visible;
  }

  /**
   * Request the bands + accessory strips for an animation. Cache hits
   * install synchronously; misses go through the bake queue and
   * land asynchronously over the next few frames.
   */
  /**
   * Request an anim. Returns a Promise that resolves `true` once
   * every band + accessory strip is in the cache and the bot is
   * rendering the new anim (commit). Resolves `false` if a later
   * `applyAnimation` call supersedes this one — the caller should
   * bail out of any action it was about to queue.
   *
   * **Path B "never frozen" contract**: callers (movement loop, AI,
   * click handlers) MUST `await` this Promise before triggering any
   * action that depends on the requested anim being on-screen. While
   * waiting:
   *  - new bots stay hidden (no partial render),
   *  - bots with a live anim keep rendering it (the live anim's
   *    frame cycle still ticks via `swapFrame`).
   * Once the Promise resolves true, the strip is hot and the next
   * action can fire.
   */
  applyAnimation(
    player: ActivePlayer,
    slot: PlayerStripSlot,
    animation: CharacterAnimation,
    animName: string,
    dir: DirSuffix,
    flipped: boolean,
  ): Promise<boolean> {
    const st = this.states.get(player.id)?.get(slot);
    if (!st) {
      log.warn(`applyAnimation: player ${player.id} slot ${slot} not attached`);
      return Promise.resolve(false);
    }
    const key = makeAnimKey(animation, animName, dir, flipped);
    // No-op if the LIVE anim already matches and nothing is pending.
    // Resolve true immediately — the caller can act right away.
    if (key === st.currentAnimKey && st.pendingAnim === null) {
      this.applyFlipToSlot(st, flipped);
      this.updateZones(st, animation);
      st.player = player;
      return Promise.resolve(true);
    }
    // If a stage is already pending for the SAME key, just refresh
    // the flip/zones — the in-flight acquires will still resolve.
    // Hand the caller the SAME promise so multiple awaits on the
    // same intended action all resolve together.
    if (st.pendingAnim && st.pendingAnim.key === key) {
      this.applyFlipToSlot(st, flipped);
      this.updateZones(st, animation);
      st.player = player;
      return st.pendingAnim.readyPromise;
    }
    st.requestedAnimKey = key;
    this.applyFlipToSlot(st, flipped);
    this.updateZones(st, animation);
    st.player = player;

    // Look up band layout for this body export (used to derive the
    // accessory Z order between bands).
    const info = this.cache.getBodyBandInfo(animation.bundle, animation.exportName);
    if (!info) {
      log.warn(
        `applyAnimation: band info missing for ${animation.bundle}/${animation.exportName}`,
      );
      return Promise.resolve(false);
    }

    // Discard any previous staging — its strips weren't installed,
    // so release their refs immediately + signal the old promise's
    // awaiters that they were superseded.
    if (st.pendingAnim) {
      this.discardPending(st.pendingAnim);
    }

    const pendingMounts = this.cache.getMounts({
      bundle: animation.bundle,
      exportName: animation.exportName,
      start: 0,
      count: animation.frameCount,
      applyBFix: flipped,
    });

    // Slot Z order map for the new anim. The slots list is sorted
    // by depth; slot i ends up at zIndex `2*i + 1` (bands at even,
    // accessories at odd, bottom-up).
    const slotZ = new Map<number, number>();
    info.slots.forEach((entry, i) => {
      slotZ.set(entry.slot, 2 * i + 1);
    });

    const accessoryRefs = animation.accessories;
    let resolve: (committed: boolean) => void = () => undefined;
    const readyPromise = new Promise<boolean>((res) => {
      resolve = res;
    });
    const pending: PendingAnim = {
      key,
      animation,
      animName,
      dir,
      flipped,
      atlasArrived: false,
      accStrips: new Map(),
      accSlots: accessoryRefs.map((a) => a.slot),
      accessoryRefs,
      slotZ,
      mounts: pendingMounts,
      resolve,
      readyPromise,
    };
    st.pendingAnim = pending;
    st.lastAnimation = animation;
    st.lastAnimName = animName;
    st.lastDir = dir;
    st.lastFlipped = flipped;

    this.stageBodyAtlas(st, pending);
    this.stageAccessories(st, pending);
    // Cache may resolve everything synchronously (full cache hit) —
    // attempt commit now so a hot path doesn't wait a frame.
    this.tryCommit(st);
    return pending.readyPromise;
  }

  /** Per-tick frame swap — O(slots × bands + slots × accessories). */
  swapFrame(player: ActivePlayer): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    const idx = player.frameIndex;
    for (const st of slots.values()) {
      const atlas = st.atlas;
      if (!atlas) continue;
      const fc = atlas.frameCount;
      if (fc === 0) continue;
      const frame = idx % fc;
      // Bands: shift UVs. All bands share the same atlas + frame
      // count, so we compute `frame` once and broadcast.
      for (const band of st.bands) {
        if (!band.mesh) continue;
        band.mesh.setFrame(frame);
      }
      // Accessories: cycle 3 sub-frames, update mount affine.
      if (st.mounts) {
        const frameInMount = idx % st.mounts.frameCount;
        const tmp = mountScratch;
        for (const acc of st.accessories.values()) {
          if (!acc.strip) continue;
          const subIdx = idx % acc.strip.frameCount;
          acc.sprite.texture = acc.strip.frames[subIdx];
          this.cache.readMountMatrix(st.mounts, frameInMount, acc.slot, tmp);
          this.applyMountToAccessory(acc, tmp);
        }
      }
    }
  }

  updateFlip(player: ActivePlayer, flipped: boolean): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    for (const st of slots.values()) {
      this.applyFlipToSlot(st, flipped);
    }
  }

  /** Re-render every live slot at a new resolution. */
  setResolutionAndRerender(res: number): void {
    const clamped = Math.max(1, res);
    if (clamped === this.resolution) return;
    this.resolution = clamped;
    for (const slots of this.states.values()) {
      for (const [slotKey, st] of slots) {
        st.currentAnimKey = "";
        this.applyFlipToSlot(st, st.lastFlipped);
        if (st.lastAnimation && st.player) {
          this.applyAnimation(
            st.player,
            slotKey,
            st.lastAnimation,
            st.lastAnimName,
            st.lastDir,
            st.lastFlipped,
          );
        }
      }
    }
  }

  detach(player: ActivePlayer): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    for (const st of slots.values()) this.retireSlotState(st);
    this.states.delete(player.id);
  }

  destroy(): void {
    for (const slots of this.states.values()) {
      for (const st of slots.values()) this.retireSlotState(st);
    }
    this.states.clear();
  }

  private createSlot(
    player: ActivePlayer,
    slot: PlayerStripSlot,
  ): SlotStateV2 {
    const root = new Container();
    root.scale.set(1 / this.resolution);
    root.sortableChildren = true;
    root.zIndex = SLOT_Z_INDEX[slot];
    player.container.addChild(root);

    // Picking shim: invisible Sprite that adopts the band-0 strip's
    // texture so the picking system's AABB + alpha-test path works
    // identically to V1. `renderable=false` keeps it from drawing
    // while still participating in the transform tree.
    const hitSprite = new Sprite();
    hitSprite.renderable = false;
    hitSprite.anchor.set(0, 0);
    root.addChild(hitSprite);

    // Path B "never frozen" contract: a bot stays HIDDEN until its
    // first applyAnimation commits — every band + accessory has
    // landed. After the first commit, the container stays visible
    // and subsequent anim swaps keep showing the live anim until the
    // next anim is fully ready (atomic swap, never partial).
    root.visible = false;

    return {
      root,
      hitSprite,
      zones: new BodyBandColourZones(),
      atlas: null,
      bands: [],
      accessories: new Map(),
      mounts: null,
      slotZ: new Map(),
      currentAnimKey: "",
      requestedAnimKey: "",
      pendingAnim: null,
      lastAnimation: null,
      lastAnimName: "",
      lastDir: "F",
      lastFlipped: false,
      player,
    };
  }

  private updateZones(st: SlotStateV2, animation: CharacterAnimation): void {
    const cz = animation.colorZones;
    // Path B mirrors V1's `setSwfPlayerColors`: value 0 (or null look)
    // means "no override" — the SWF's authored palette renders
    // untouched. BodyBandColourZones.setColours encodes the inactive
    // flag in the UBO so the shader skips recolor for that zone.
    if (cz) {
      st.zones.setColours(cz[0], cz[1], cz[2]);
    } else {
      st.zones.setColours(0, 0, 0);
    }
  }

  private applyFlipToSlot(st: SlotStateV2, flipped: boolean): void {
    const s = 1 / this.resolution;
    st.root.scale.set(flipped ? -s : s, s);
  }

  /** Kick off the single body-atlas acquire for `pending`. The atlas
   *  bake produces colour + zone textures and the per-band sub-rect
   *  metadata in one call — `bandCount × 2` allocations collapse to
   *  exactly 2 per anim. */
  private stageBodyAtlas(st: SlotStateV2, pending: PendingAnim): void {
    this.cache.acquireBodyAtlas(
      {
        bundle: pending.animation.bundle,
        exportName: pending.animation.exportName,
        start: 0,
        count: pending.animation.frameCount,
        totalFrameCount: pending.animation.frameCount,
        resolution: this.resolution,
        applyBFix: pending.flipped,
      },
      (atlas) => this.onAtlasLanded(st, pending, atlas),
      () => st.pendingAnim === pending,
    );
  }

  /** Kick off accessory acquires for `pending`. Same staging contract
   *  as `stageBodyAtlas` — no live state mutated until commit. */
  private stageAccessories(st: SlotStateV2, pending: PendingAnim): void {
    for (const accDef of pending.accessoryRefs) {
      const slotId = accDef.slot;
      this.cache.acquireAccessory(
        {
          bundle: accDef.bundle,
          exportName: accDef.exportName,
          slot: slotId,
          animType: accDef.animType,
          dir: pending.dir,
          // `side` defaults to dir; canonical W-prefix opt-in lives
          // in the body's mount declaration which we don't surface
          // here yet — accurate cape walk frames are a follow-up.
          side: pending.dir,
          resolution: this.resolution,
        },
        (strip) => this.onAccessoryLanded(st, pending, slotId, strip),
        () => st.pendingAnim === pending,
      );
    }
  }

  private onAtlasLanded(
    st: SlotStateV2,
    pending: PendingAnim,
    atlas: BodyAtlas | null,
  ): void {
    // Pending was discarded (another applyAnimation superseded it)
    // — release the atlas here so we don't leak the ref.
    if (st.pendingAnim !== pending) {
      if (atlas) this.cache.releaseBodyAtlas(atlas);
      return;
    }
    pending.atlas = atlas;
    pending.atlasArrived = true;
    this.tryCommit(st);
  }

  private onAccessoryLanded(
    st: SlotStateV2,
    pending: PendingAnim,
    slotId: number,
    strip: AccessoryStrip | null,
  ): void {
    if (st.pendingAnim !== pending) {
      if (strip) this.cache.releaseAccessory(strip);
      return;
    }
    pending.accStrips.set(slotId, strip);
    this.tryCommit(st);
  }

  /** Atomic swap: only fires once the body atlas AND every staged
   *  accessory has reported. The live state (bands + accessories +
   *  mounts + zIndex map) flips in a single tick — bots never display
   *  a half-loaded anim. */
  private tryCommit(st: SlotStateV2): void {
    const pending = st.pendingAnim;
    if (!pending) return;
    if (!pending.atlasArrived) return;
    if (pending.accStrips.size < pending.accSlots.length) return;

    const nextAtlas = pending.atlas ?? null;

    // 1. Release prior live state. The old atlas ref drops here; if
    //    its refcount goes to 0 it becomes eligible for LRU eviction
    //    via the cache's standard retire flow.
    for (const band of st.bands) {
      if (band.mesh) band.mesh.destroy();
    }
    if (st.atlas) {
      this.cache.releaseBodyAtlas(st.atlas);
    }

    // 2. Build new band hooks if the atlas bake succeeded. Each band
    //    points at the SAME atlas texture pair; the BodyBandMesh
    //    handles UV math to address its own sub-region.
    const newBands: BandHook[] = [];
    if (nextAtlas) {
      for (const bandInfo of nextAtlas.bands) {
        const mesh = new BodyBandMesh(nextAtlas, bandInfo, st.zones);
        mesh.mesh.zIndex = bandInfo.bandIndex * 2;
        st.root.addChild(mesh.mesh);
        newBands.push({ bandIndex: bandInfo.bandIndex, mesh });
      }
      // Picking shim: hit-test reads from the atlas. The bands all
      // share frame size + anchor so AABB matches the live render;
      // alpha-test now covers EVERY band (full silhouette), not
      // just band 0 like the per-strip era.
      st.hitSprite.texture = nextAtlas.colorTexture;
      const fw = nextAtlas.frameWidth || 1;
      const fh = nextAtlas.frameHeight || 1;
      st.hitSprite.anchor.set(nextAtlas.anchorX / fw, nextAtlas.anchorY / fh);
    }
    st.bands = newBands;
    st.atlas = nextAtlas;

    // 3. Release old accessory sprites + tear down those no longer
    //    worn; reuse the Sprite for slots that survive the swap.
    const newAccessories = new Map<number, AccessoryHook>();
    const keepSlots = new Set(pending.accSlots);
    for (const [slotId, oldHook] of st.accessories) {
      if (keepSlots.has(slotId)) continue;
      if (oldHook.strip) this.cache.releaseAccessory(oldHook.strip);
      try {
        oldHook.sprite.parent?.removeChild(oldHook.sprite);
        oldHook.sprite.destroy();
      } catch {}
    }
    for (const accDef of pending.accessoryRefs) {
      const slotId = accDef.slot;
      const strip = pending.accStrips.get(slotId) ?? null;
      let hook = st.accessories.get(slotId);
      if (hook) {
        // Reuse the existing sprite, release its old strip ref.
        if (hook.strip) this.cache.releaseAccessory(hook.strip);
      } else {
        const sprite = new Sprite();
        sprite.anchor.set(0, 0);
        st.root.addChild(sprite);
        hook = { sprite, strip: null, slot: slotId };
      }
      hook.sprite.zIndex = pending.slotZ.get(slotId) ?? 1;
      if (strip) {
        hook.strip = strip;
        hook.sprite.texture = strip.frames[0] ?? strip.texture;
        hook.sprite.anchor.set(
          strip.anchorX / strip.frameWidth,
          strip.anchorY / strip.frameHeight,
        );
        hook.sprite.visible = true;
      } else {
        hook.strip = null;
        hook.sprite.visible = false;
      }
      newAccessories.set(slotId, hook);
    }
    st.accessories = newAccessories;

    // 4. Promote mount-transform table + Z order + current key.
    st.mounts = pending.mounts;
    st.slotZ = pending.slotZ;
    st.currentAnimKey = pending.key;
    st.pendingAnim = null;

    // 5. First successful commit reveals the bot. Subsequent commits
    //    are no-ops on visibility — bots stay visible from here on.
    st.root.visible = true;

    // 6. Signal awaiters that the anim is live. Caller can now
    //    trigger the action (movement, etc.) it was holding for.
    pending.resolve(true);
  }

  /** Discard a staging in flight — release any strips that already
   *  landed and prevent any still-pending acquires from doing work.
   *  Resolves the staging's promise with `false` so awaiters know
   *  they were superseded and can decide whether to retry against
   *  the latest anim. */
  private discardPending(pending: PendingAnim): void {
    if (pending.atlas) {
      this.cache.releaseBodyAtlas(pending.atlas);
      pending.atlas = null;
    }
    for (const strip of pending.accStrips.values()) {
      if (strip) this.cache.releaseAccessory(strip);
    }
    pending.accStrips.clear();
    pending.resolve(false);
  }

  private applyMountToAccessory(
    acc: AccessoryHook,
    m: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  ): void {
    // Mount affine is in TWIP space; translation needs scaling by
    // `resolution / 20` to land in pixel space. The accessory strip's
    // anchor (Pixi `Sprite.anchor`) accounts for the accessory's own
    // local origin offset; the mount affine then positions that
    // origin inside the per-bot container's coord space.
    const scale = this.resolution / 20;
    const pixelMatrix = new Matrix(m.a, m.b, m.c, m.d, m.tx * scale, m.ty * scale);
    acc.sprite.setFromMatrix(pixelMatrix);
  }

  private retireSlotState(st: SlotStateV2): void {
    st.requestedAnimKey = "<retired>";
    st.currentAnimKey = "<retired>";
    st.player = null;
    // Wake up any awaiters with false so they bail out instead of
    // acting on a detached slot.
    if (st.pendingAnim) {
      this.discardPending(st.pendingAnim);
      st.pendingAnim = null;
    }
    for (const band of st.bands) {
      if (band.mesh) band.mesh.destroy();
    }
    st.bands = [];
    if (st.atlas) {
      this.cache.releaseBodyAtlas(st.atlas);
      st.atlas = null;
    }
    for (const hook of st.accessories.values()) {
      if (hook.strip) this.cache.releaseAccessory(hook.strip);
      try {
        hook.sprite.parent?.removeChild(hook.sprite);
        hook.sprite.destroy();
      } catch {}
    }
    st.accessories.clear();
    try {
      st.root.parent?.removeChild(st.root);
      st.root.destroy({ children: true });
    } catch {}
  }
}

// Scratch object reused across accessory tick updates to avoid GC.
const mountScratch = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

// Silence unused import warning when `MAX_SLOT` reference is removed in
// future cleanup. Kept as a compile-time tap so this module flags if
// the cache's max slot value changes underneath us.
void MAX_SLOT;
