import { createLogger } from "@/utils/logger";

const log = createLogger("Audio");
const SOUNDS_ENABLED = false;
const MUSIC_BASE_PATH = "/assets/sound/musics/";
const FADE_DURATION_MS = 4000;

interface MusicData {
  mapToFile: Record<string, string>;
  musicMeta: Record<string, { volume: number; loop: boolean }>;
}

export class AudioManager {
  private static instance: AudioManager | null = null;

  private musicData: MusicData | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentFile: string | null = null;
  private savedFile: string | null = null;
  private savedTime = 0;
  private masterVolume = 0.3;
  private muted = false;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  private initPromise: Promise<void> | null = null;

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }

    return AudioManager.instance;
  }

  init(): Promise<void> {
    if (!SOUNDS_ENABLED) {
      return Promise.resolve();
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = fetch("/assets/data/music-data.json")
      .then((resp) => resp.json())
      .then((data: MusicData) => {
        this.musicData = data;
        log.debug(
          `Loaded music data: ${Object.keys(data.mapToFile).length} maps`
        );
      })
      .catch((e) => {
        log.error("Failed to load music data:", e);
      });
    return this.initPromise;
  }

  /** Play music for the given map. Waits for init if needed. */
  async playForMap(mapId: number): Promise<void> {
    // Ensure data is loaded before lookup
    await this.initPromise;

    if (!this.musicData) {
      return;
    }

    const file = this.musicData.mapToFile[String(mapId)];

    if (!file) {
      log.debug("No music for map", mapId);
      return;
    }

    if (file === this.currentFile) {
      return;
    }

    log.debug("Map", mapId, "→", file);
    this.playMusic(file);
  }

  /** Save current music and play fight music (for fight start). */
  saveMusicAndPlay(file: string): void {
    if (this.currentAudio && this.currentFile) {
      this.savedFile = this.currentFile;
      this.savedTime = this.currentAudio.currentTime;
    }

    this.playMusic(file);
  }

  /** Restore saved music after fight. */
  restoreSavedMusic(): void {
    if (this.savedFile) {
      this.playMusic(this.savedFile, this.savedTime);
      this.savedFile = null;
      this.savedTime = 0;
    }
  }

  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));

    if (this.currentAudio && !this.muted) {
      this.currentAudio.volume = this.masterVolume;
    }
  }

  getVolume(): number {
    return this.masterVolume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;

    if (this.currentAudio) {
      this.currentAudio.muted = muted;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  stop(): void {
    this.fadeOutAndStop();
  }

  private playMusic(file: string, startTime = 0): void {
    const meta = this.musicData?.musicMeta[file];
    const loop = meta?.loop ?? true;

    // Immediately claim the new file so rapid calls don't race
    this.currentFile = file;

    // Kill any in-progress fade
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    const oldAudio = this.currentAudio;
    this.currentAudio = null;

    if (oldAudio) {
      // Fade out old track, then start new
      this.fadeOutAudio(oldAudio, () =>
        this.startNewTrack(file, loop, startTime)
      );
    } else {
      this.startNewTrack(file, loop, startTime);
    }
  }

  private startNewTrack(file: string, loop: boolean, startTime: number): void {
    // Guard: if another playMusic was called while we were fading, abort
    if (this.currentFile !== file) {
      return;
    }

    const audio = new Audio(MUSIC_BASE_PATH + file);
    audio.loop = loop;
    audio.volume = 0;
    audio.muted = this.muted;

    this.currentAudio = audio;

    const onReady = () => {
      // Stale check
      if (this.currentAudio !== audio) {
        audio.pause();
        audio.src = "";
        return;
      }

      if (startTime > 0) {
        audio.currentTime = startTime;
      }

      audio.play().catch(() => {
        // Autoplay blocked — retry on user interaction
        const resume = () => {
          if (this.currentAudio === audio) {
            audio.play().catch(() => {});
          }

          document.removeEventListener("click", resume);
          document.removeEventListener("keydown", resume);
        };
        document.addEventListener("click", resume, { once: true });
        document.addEventListener("keydown", resume, { once: true });
      });
      this.fadeIn(audio);
    };

    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener(
      "error",
      () => {
        log.warn("Failed to load:", file);
      },
      { once: true }
    );
  }

  private fadeIn(audio: HTMLAudioElement): void {
    const targetVolume = this.masterVolume;
    const steps = 20;
    const stepMs = FADE_DURATION_MS / 2 / steps;
    let step = 0;

    const interval = setInterval(() => {
      if (this.currentAudio !== audio) {
        clearInterval(interval);
        return;
      }

      step++;
      audio.volume = Math.min(targetVolume, (step / steps) * targetVolume);

      if (step >= steps) {
        clearInterval(interval);
        audio.volume = targetVolume;
      }
    }, stepMs);
  }

  /** Fade out a specific audio element and dispose it. Does NOT touch currentAudio/currentFile. */
  private fadeOutAudio(audio: HTMLAudioElement, onDone?: () => void): void {
    const startVolume = audio.volume;

    if (startVolume <= 0) {
      audio.pause();
      audio.src = "";
      onDone?.();
      return;
    }

    const steps = 20;
    const stepMs = FADE_DURATION_MS / steps;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVolume * (1 - step / steps));

      if (step >= steps) {
        clearInterval(interval);
        audio.pause();
        audio.src = "";
        onDone?.();
      }
    }, stepMs);
  }

  private fadeOutAndStop(onDone?: () => void): void {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    const audio = this.currentAudio;
    this.currentAudio = null;
    this.currentFile = null;

    if (!audio) {
      onDone?.();
      return;
    }

    this.fadeOutAudio(audio, onDone);
  }

  destroy(): void {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
    }

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
    }

    this.currentAudio = null;
    this.currentFile = null;
    AudioManager.instance = null;
  }
}
