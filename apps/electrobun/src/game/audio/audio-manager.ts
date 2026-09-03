import { createLogger } from "@/utils/logger";

import type { Sound, SoundFactory } from "./sound";
import { createHtmlSound } from "./sound";

const log = createLogger("Audio");

const MUSICS_PATH = "/assets/sound/musics/";
const EFFECTS_PATH = "/assets/sound/effects/";
const LANG_BUNDLE_URL = "/assets/langs/fr/audio.json";

/** `AudioManager.MUSIC_FADE_OUT_LENGTH` in the retail client is 4 seconds. */
const FADE_MS = 4000;
const FADE_STEPS = 20;

/** One entry of the `AUM` (musics) or `AUE` (effects) lang table. */
interface LangSound {
  /** File name, e.g. `loc_amakna.mp3` — also the published asset's name. */
  f: string;
  /** Base volume, 0-100, scaled by the channel volume. */
  v: number;
  /** Loop forever. True for every music, false for every effect. */
  l: boolean;
  /** Start offset in seconds. */
  o: number;
}

/**
 * One entry of the `AUA` (ambiances) lang table: a continuous bed (`bg`) with
 * one-shot noises (`n`) fired every `mind + rand(maxd)` seconds over it. The
 * ids in both lists index `AUE`.
 */
interface LangAmbiance {
  bg: number[];
  n: number[];
  mind: number;
  maxd: number;
}

interface AudioLang {
  AUM: Record<string, LangSound>;
  AUE: Record<string, LangSound>;
  AUA: Record<string, LangAmbiance>;
  /**
   * `AUEC` — effect keyname → `AUE` id. The animations that trigger their
   * own sound name it by its SWF linkage name, and this is the only table
   * that turns that name into an id. Optional because a bundle predating
   * the constants still plays every id-addressed sound.
   */
  AUEC?: Record<string, number>;
}

/** Injected so `AudioManager`'s scheduling is testable without real time. */
export interface Timers {
  setInterval(fn: () => void, ms: number): number;
  clearInterval(handle: number): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const REAL_TIMERS: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clearInterval: (h) => clearInterval(h),
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (h) => clearTimeout(h),
};

export interface AudioManagerDeps {
  createSound?: SoundFactory;
  timers?: Timers;
  random?: () => number;
  loadLang?: () => Promise<AudioLang | null>;
}

type Channel = "music" | "environment" | "effects";

/**
 * Plays the game's music and ambient sound, driven by the same ids the retail
 * client used.
 *
 * The server sends `musicId` and `ambianceId` on every `gameMapData` frame
 * (imported from the retail map SWFs — see `scripts/import-map-swf.ts`). Both
 * index the `audio` lang bundle, which is the only thing that knows the file
 * names: `AUM[musicId].f` is an mp3 under `sound/musics/`, and
 * `AUA[ambianceId]` names the `sound/effects/` clips that make up an
 * environment.
 *
 * Mirrors `dofus.sounds.AudioManager` (`playMusic` / `playEnvironment` /
 * `playEffect`), including the 4-second cross-fade between tracks and the
 * randomised noise timer.
 */
export class AudioManager {
  private static instance: AudioManager | null = null;

  private readonly createSound: SoundFactory;
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly loadLang: () => Promise<AudioLang | null>;

  private lang: AudioLang | null = null;
  private initPromise: Promise<void> | null = null;

  private readonly volumes: Record<Channel, number> = {
    music: 0.3,
    environment: 0.3,
    effects: 0.5,
  };
  private readonly mutes: Record<Channel, boolean> = {
    music: false,
    environment: false,
    effects: false,
  };

  private music: Sound | null = null;
  private musicId = 0;
  private savedMusicId = 0;
  private savedMusicAt = 0;

  private ambianceId = 0;
  private ambianceBed: Sound[] = [];
  private noiseTimer: number | null = null;

  /** One in-flight fade per sound, so a re-target never fights an old one. */
  private readonly fades = new Map<Sound, number>();

  constructor(deps: AudioManagerDeps = {}) {
    this.createSound = deps.createSound ?? createHtmlSound;
    this.timers = deps.timers ?? REAL_TIMERS;
    this.random = deps.random ?? Math.random;
    this.loadLang = deps.loadLang ?? defaultLoadLang;
  }

  static getInstance(): AudioManager {
    AudioManager.instance ??= new AudioManager();
    return AudioManager.instance;
  }

  init(): Promise<void> {
    this.initPromise ??= this.loadLang()
      .then((lang) => {
        this.lang = lang;

        if (lang) {
          log.debug(
            `audio lang loaded: ${Object.keys(lang.AUM).length} musics, ` +
              `${Object.keys(lang.AUE).length} effects, ` +
              `${Object.keys(lang.AUA).length} ambiances, ` +
              `${Object.keys(lang.AUEC ?? {}).length} effect names`
          );
        }
      })
      .catch((err) => {
        log.error("Failed to load the audio lang bundle:", err);
      });

    return this.initPromise;
  }

  /**
   * Switch to the map's music. `saveOld` keeps the current track's id and
   * position so `backToOldMusic()` can resume it — that is how the retail
   * client returns to the map theme when a fight ends.
   *
   * Id 0 means the map has no music, in which case the current one keeps
   * playing, matching `DofusBattlefield.as:134` (`if musicID > 0`).
   */
  async playMusic(id: number, saveOld = false): Promise<void> {
    await this.initPromise;

    if (id <= 0 || id === this.musicId) return;

    const entry = this.lang?.AUM[String(id)];

    if (!entry) {
      log.warn(`No music ${id} in the lang bundle`);
      return;
    }

    if (saveOld && this.music) {
      this.savedMusicId = this.musicId;
      this.savedMusicAt = this.music.position();
    }

    this.musicId = id;
    this.startMusic(entry, 0);
  }

  /** Resume the track stashed by the last `playMusic(id, true)`. */
  async backToOldMusic(): Promise<void> {
    const id = this.savedMusicId;
    const at = this.savedMusicAt;
    this.savedMusicId = 0;
    this.savedMusicAt = 0;

    if (id <= 0) return;

    await this.initPromise;
    const entry = this.lang?.AUM[String(id)];

    if (!entry) return;

    this.musicId = id;
    this.startMusic(entry, at);
  }

  /**
   * Switch the ambient bed. Id 0 leaves the current one alone, matching
   * `DofusBattlefield.as:130` (`if ambianceID > 0`).
   */
  async playEnvironment(id: number): Promise<void> {
    await this.initPromise;

    if (id <= 0 || id === this.ambianceId) return;

    const ambiance = this.lang?.AUA[String(id)];

    if (!ambiance) {
      log.warn(`No ambiance ${id} in the lang bundle`);
      return;
    }

    this.stopEnvironment(true);
    this.ambianceId = id;

    for (const effectId of ambiance.bg) {
      const entry = this.lang?.AUE[String(effectId)];

      if (!entry) continue;

      const sound = this.spawn(EFFECTS_PATH + entry.f, {
        loop: true,
        startAt: entry.o,
      });
      sound.setVolume(this.levelFor("environment", entry.v));
      sound.setMuted(this.mutes.environment);
      sound.play();
      this.ambianceBed.push(sound);
    }

    this.scheduleNoise(ambiance);
  }

  /** Fire a one-shot effect — `AUE[id]`. */
  playEffect(id: number, channel: Channel = "effects"): void {
    const entry = this.lang?.AUE[String(id)];

    if (!entry) return;

    const sound = this.spawn(EFFECTS_PATH + entry.f, {
      loop: false,
      startAt: entry.o,
    });
    sound.setVolume(this.levelFor(channel, entry.v));
    sound.setMuted(this.mutes[channel]);
    sound.play();
  }

  /**
   * Fire a one-shot effect by its **linkage name** — `AudioManager.playSound`
   * (`assets/sources/client-code/dofus/sounds/AudioManager.as:206`).
   *
   * A sound an animation triggers names itself the way its SWF symbol does
   * (`cassage_bois`, `flotteur`, `hache_2m`), never by id: retail folds that
   * name into the lang bundle's keyname — spaces, accents and dashes out,
   * upper case — and looks it up in `AUEC`.
   *
   * A name that resolves to nothing is dropped. Retail then falls back to
   * the packed sound of the same linkname, which this client does not ship:
   * the 139 effects that have no `AUE` id are unreachable here.
   */
  playSound(name: string, channel: Channel = "effects"): void {
    const keyname = name
      .replace(/[ -]/g, "_")
      .replace(/é/g, "e")
      .replace(/à/g, "a")
      .toUpperCase();

    const id = this.lang?.AUEC?.[keyname];

    if (id === undefined) {
      log.warn(`No effect named ${keyname} in the lang bundle`);
      return;
    }

    this.playEffect(id, channel);
  }

  setVolume(channel: Channel, volume: number): void {
    this.volumes[channel] = Math.max(0, Math.min(1, volume));
    this.applyVolumes();
  }

  getVolume(channel: Channel): number {
    return this.volumes[channel];
  }

  setMuted(channel: Channel, muted: boolean): void {
    this.mutes[channel] = muted;

    if (channel === "music") this.music?.setMuted(muted);

    if (channel === "environment") {
      for (const sound of this.ambianceBed) sound.setMuted(muted);
    }
  }

  isMuted(channel: Channel): boolean {
    return this.mutes[channel];
  }

  getMusicId(): number {
    return this.musicId;
  }

  getAmbianceId(): number {
    return this.ambianceId;
  }

  /**
   * Silence everything at once — used when leaving the world (logout,
   * disconnect). Unlike a map change this does not fade: the world is gone,
   * so there is nothing left to fade against.
   */
  stop(): void {
    this.stopEnvironment(false);
    this.music?.stop();
    this.music = null;
    this.musicId = 0;
    this.savedMusicId = 0;
    this.savedMusicAt = 0;
    this.cancelFades();
  }

  destroy(): void {
    this.stop();

    if (AudioManager.instance === this) {
      AudioManager.instance = null;
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private startMusic(entry: LangSound, startAt: number): void {
    const previous = this.music;
    const next = this.spawn(MUSICS_PATH + entry.f, {
      loop: entry.l,
      startAt: startAt > 0 ? startAt : entry.o,
    });

    this.music = next;

    if (previous) this.fadeOut(previous);

    next.setVolume(0);
    next.setMuted(this.mutes.music);
    next.play();
    this.fade(next, () => this.levelFor("music", entry.v));
  }

  private stopEnvironment(fade: boolean): void {
    for (const sound of this.ambianceBed) {
      if (fade) this.fadeOut(sound);
      else sound.stop();
    }

    this.ambianceBed = [];
    this.ambianceId = 0;

    if (this.noiseTimer !== null) {
      this.timers.clearTimeout(this.noiseTimer);
      this.noiseTimer = null;
    }
  }

  /**
   * `AudioManager.nextEnvironmentNoise` — one noise every
   * `mind + round(rand * maxd)` seconds, never sooner than 10ms.
   */
  private scheduleNoise(ambiance: LangAmbiance): void {
    if (ambiance.n.length === 0) return;

    const delay = Math.max(
      10,
      (ambiance.mind + Math.round(this.random() * ambiance.maxd)) * 1000
    );

    this.noiseTimer = this.timers.setTimeout(() => {
      this.noiseTimer = null;
      const pick = Math.floor(ambiance.n.length * this.random());
      this.playEffect(ambiance.n[pick]!, "environment");
      this.scheduleNoise(ambiance);
    }, delay);
  }

  private spawn(
    url: string,
    options: { loop: boolean; startAt: number }
  ): Sound {
    return this.createSound(url, options);
  }

  /** Per-sound base volume (0-100 in the lang table) scaled by the channel. */
  private levelFor(channel: Channel, baseVolume: number): number {
    return (this.volumes[channel] * baseVolume) / 100;
  }

  private applyVolumes(): void {
    const music = this.lang?.AUM[String(this.musicId)];

    if (this.music && music) {
      this.music.setVolume(this.levelFor("music", music.v));
    }

    const ambiance = this.lang?.AUA[String(this.ambianceId)];

    if (ambiance) {
      this.ambianceBed.forEach((sound, i) => {
        const entry = this.lang?.AUE[String(ambiance.bg[i])];

        if (entry) sound.setVolume(this.levelFor("environment", entry.v));
      });
    }
  }

  private fadeOut(sound: Sound): void {
    // The sound is already detached from `music` / `ambianceBed`, so nothing
    // else will touch it before the fade disposes of it.
    this.fade(sound, () => 0, () => sound.stop());
  }

  /**
   * Ramp `sound` to `target()` over `FADE_MS`. The target is re-read on every
   * step so a volume change mid-fade lands where the player expects, and any
   * fade already running on this sound is cancelled first.
   */
  private fade(sound: Sound, target: () => number, onDone?: () => void): void {
    this.cancelFade(sound);

    const from = sound.volume();
    let step = 0;

    const handle = this.timers.setInterval(() => {
      step++;
      const to = target();
      sound.setVolume(from + (to - from) * (step / FADE_STEPS));

      if (step >= FADE_STEPS) {
        this.cancelFade(sound);
        onDone?.();
      }
    }, FADE_MS / FADE_STEPS);

    this.fades.set(sound, handle);
  }

  private cancelFade(sound: Sound): void {
    const handle = this.fades.get(sound);

    if (handle === undefined) return;

    this.timers.clearInterval(handle);
    this.fades.delete(sound);
  }

  private cancelFades(): void {
    for (const handle of this.fades.values()) this.timers.clearInterval(handle);

    this.fades.clear();
  }
}

async function defaultLoadLang(): Promise<AudioLang | null> {
  const res = await fetch(LANG_BUNDLE_URL);

  if (!res.ok) return null;

  const json = (await res.json()) as { data?: Partial<AudioLang> };
  const data = json.data;

  if (!data?.AUM || !data.AUE || !data.AUA) return null;

  // `AUEC` travels with them: without it every sound an animation names by
  // its linkage name resolves to nothing (QA-147).
  return {
    AUM: data.AUM,
    AUE: data.AUE,
    AUA: data.AUA,
    ...(data.AUEC ? { AUEC: data.AUEC } : {}),
  };
}
