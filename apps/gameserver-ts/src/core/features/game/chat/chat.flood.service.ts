import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { ChatChannel } from "@dofus/proto/common_pb";
import { Injectable } from "@nestjs/common";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

/**
 * Per-channel send interval, in milliseconds. Retail throttles the broadcast
 * channels to keep them readable (lang key INFOS_115); the channels that only
 * reach a map or a fight are not throttled. **This table is the only tuning
 * point** — everything else derives from it.
 */
const CHANNEL_COOLDOWN_MS: Partial<Record<ChatChannel, number>> = {
  [ChatChannel.TRADE]: 120_000,
  [ChatChannel.RECRUITMENT]: 60_000,
  [ChatChannel.ALIGNMENT]: 60_000,
};

export function cooldownMsFor(channel: ChatChannel): number {
  return CHANNEL_COOLDOWN_MS[channel] ?? 0;
}

const LONGEST_COOLDOWN_MS = Math.max(...Object.values(CHANNEL_COOLDOWN_MS));

/**
 * Characters are swept lazily rather than on disconnect: a cooldown that a
 * reconnect could clear would not be an anti-flood. Once an entry is older than
 * the longest cooldown it can no longer refuse anything, so it is free to drop.
 */
const SWEEP_ABOVE_ENTRIES = 512;

interface FloodEntry {
  characterId: string;
  channel: ChatChannel;
  lastSentAt: number;
}

/**
 * Tracks when each character last spoke on each throttled channel. Serialized
 * across the blue/green handoff so a core restart does not hand everyone a free
 * pass on the broadcast channels.
 */
@Injectable()
@HandoffPart()
export class ChatFloodService implements Serializable<FloodEntry[]> {
  readonly name = "chat.flood";

  private readonly lastSentAt = new Map<string, Map<ChatChannel, number>>();

  /** Seconds the character must still wait; 0 when the channel is clear. */
  check(characterId: string, channel: ChatChannel, now: number): number {
    const cooldown = cooldownMsFor(channel);

    if (cooldown === 0) {
      return 0;
    }

    const last = this.lastSentAt.get(characterId)?.get(channel);

    if (last === undefined) {
      return 0;
    }

    const remaining = last + cooldown - now;

    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  commit(characterId: string, channel: ChatChannel, now: number): void {
    if (cooldownMsFor(channel) === 0) {
      return;
    }

    if (this.lastSentAt.size > SWEEP_ABOVE_ENTRIES) {
      this.sweep(now);
    }

    let byChannel = this.lastSentAt.get(characterId);

    if (!byChannel) {
      byChannel = new Map();
      this.lastSentAt.set(characterId, byChannel);
    }

    byChannel.set(channel, now);
  }

  private sweep(now: number): void {
    for (const [characterId, byChannel] of this.lastSentAt) {
      for (const [channel, at] of byChannel) {
        if (at + cooldownMsFor(channel) <= now) {
          byChannel.delete(channel);
        }
      }

      if (byChannel.size === 0) {
        this.lastSentAt.delete(characterId);
      }
    }
  }

  serialize(): FloodEntry[] {
    const out: FloodEntry[] = [];

    for (const [characterId, byChannel] of this.lastSentAt) {
      for (const [channel, at] of byChannel) {
        out.push({ characterId, channel, lastSentAt: at });
      }
    }

    return out;
  }

  restore(entries: FloodEntry[]): void {
    this.lastSentAt.clear();

    for (const entry of entries) {
      this.commit(entry.characterId, entry.channel, entry.lastSentAt);
    }
  }
}
