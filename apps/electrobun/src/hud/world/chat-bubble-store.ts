import { ExternalStore } from "@/game/stores/game-store";

/**
 * One speech bubble anchored over a sprite. Mirrors canonical Dofus 1.29
 * `ank.battlefield.mc.Bubble` — pale rounded box with a tail pointing down at
 * the speaker, one bubble per sprite, self-expiring.
 *
 * `anchorX` / `anchorY` are CSS pixels in canvas-relative space, the same coord
 * space the nameplates use, since both render inside HudOverlay's
 * canvas-aligned wrapper.
 */
export interface ChatBubbleEntry {
  id: number;
  text: string;
  anchorX: number;
  anchorY: number;
  /** Epoch ms after which the bubble is dropped. */
  expiresAt: number;
}

interface ChatBubblesState {
  entries: readonly ChatBubbleEntry[];
}

const initial: ChatBubblesState = { entries: [] };

export const chatBubbleStore = new ExternalStore<ChatBubblesState>(initial);

/**
 * Retail lifetime: a flat 4 s plus 50 ms per character, so a long line stays up
 * long enough to read (ank/battlefield/Constants.as:32-33).
 */
const BUBBLE_BASE_MS = 4000;
const BUBBLE_PER_CHAR_MS = 50;

export function bubbleLifetimeMs(text: string): number {
  return BUBBLE_BASE_MS + text.length * BUBBLE_PER_CHAR_MS;
}

/** Show a bubble, replacing whatever that sprite was already saying. */
export function setChatBubble(entry: ChatBubbleEntry): void {
  const { entries } = chatBubbleStore.getSnapshot();
  const existing = entries.find((e) => e.id === entry.id);

  if (
    existing &&
    existing.text === entry.text &&
    existing.anchorX === entry.anchorX &&
    existing.anchorY === entry.anchorY &&
    existing.expiresAt === entry.expiresAt
  ) {
    return;
  }

  const without = existing ? entries.filter((e) => e.id !== entry.id) : entries;

  chatBubbleStore.setState({ entries: [...without, entry] });
}

export function hideChatBubble(id: number): void {
  const { entries } = chatBubbleStore.getSnapshot();
  const next = entries.filter((e) => e.id !== id);

  if (next.length !== entries.length) {
    chatBubbleStore.setState({ entries: next });
  }
}

export function clearChatBubbles(): void {
  const { entries } = chatBubbleStore.getSnapshot();

  if (entries.length > 0) {
    chatBubbleStore.setState({ entries: [] });
  }
}
