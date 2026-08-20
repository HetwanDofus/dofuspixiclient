/**
 * The one place that touches `HTMLAudioElement`.
 *
 * `AudioManager` drives sounds through this interface only, so its scheduling
 * — fades, ambiance timers, save/restore across fights — can be unit-tested
 * with a fake factory and no DOM.
 */
export interface Sound {
  /** Start playback. Safe to call once per instance. */
  play(): void;
  /** Stop and release. The instance is dead afterwards. */
  stop(): void;
  /** 0..1, already multiplied by the channel and per-sound base volume. */
  setVolume(volume: number): void;
  /** Current 0..1 level — the starting point of a fade-out. */
  volume(): number;
  setMuted(muted: boolean): void;
  /** Seconds into the track, for save/restore across a fight. */
  position(): number;
}

export type SoundFactory = (
  url: string,
  options: { loop: boolean; startAt: number }
) => Sound;

export const createHtmlSound: SoundFactory = (url, { loop, startAt }) => {
  const audio = new Audio(url);
  audio.loop = loop;
  audio.volume = 0;
  audio.preload = "auto";

  let started = false;

  const start = () => {
    if (startAt > 0) {
      audio.currentTime = startAt;
    }

    audio.play().catch(() => {
      // Browsers refuse autoplay until the page has been interacted with.
      // Retry on the first click or key press, which is exactly what the
      // player does to walk anywhere.
      const resume = () => {
        audio.play().catch(() => {});
        document.removeEventListener("click", resume);
        document.removeEventListener("keydown", resume);
      };
      document.addEventListener("click", resume, { once: true });
      document.addEventListener("keydown", resume, { once: true });
    });
  };

  return {
    play() {
      if (started) return;
      started = true;

      if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        start();
      } else {
        audio.addEventListener("canplay", start, { once: true });
      }
    },
    stop() {
      audio.pause();
      audio.src = "";
    },
    setVolume(volume) {
      audio.volume = Math.max(0, Math.min(1, volume));
    },
    volume() {
      return audio.volume;
    },
    setMuted(muted) {
      audio.muted = muted;
    },
    position() {
      return audio.currentTime;
    },
  };
};
