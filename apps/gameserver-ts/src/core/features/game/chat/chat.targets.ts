import type { ChatDestination } from "@features/game/chat/chat.channels";
import { ChatErrorReason } from "@dofus/proto/chat_pb";
import { ChatChannel } from "@dofus/proto/common_pb";
import { match } from "ts-pattern";

/**
 * The narrow slice of the world this resolver needs. Passing it in keeps the
 * routing rules a pure function — the interesting part is a table, and a table
 * is worth testing without a Nest container around it.
 */
export interface ChatTargetPorts {
  /** Sessions on a map, author included — the general channel echoes back. */
  sessionsOnMap(mapId: number): string[];
  /** Every live session, for the server-wide channels. */
  allSessions(): string[];
  /** Online player by name, case-insensitive. */
  getByName(name: string): { sessionId: string; name: string } | undefined;
  /** Allied sessions in the author's current fight; undefined when not fighting. */
  teamSessions(sessionId: string): string[] | undefined;
}

export interface ChatAuthor {
  sessionId: string;
  characterId: string;
  name: string;
  mapId: number;
}

/**
 * What the handler should put on the wire. A whisper is two frames with
 * different channels and different sender names, so it is its own shape rather
 * than a target list.
 */
export type ChatDelivery =
  | { kind: "broadcast"; channel: ChatChannel; targets: string[] }
  | { kind: "whisper"; targetSessionId: string; targetName: string };

export type ChatRouting =
  | { ok: true; delivery: ChatDelivery }
  | { ok: false; reason: ChatErrorReason; detail?: string };

function fail(reason: ChatErrorReason, detail?: string): ChatRouting {
  return detail === undefined
    ? { ok: false, reason }
    : { ok: false, reason, detail };
}

function broadcast(channel: ChatChannel, targets: string[]): ChatRouting {
  return { ok: true, delivery: { kind: "broadcast", channel, targets } };
}

function resolveWhisper(
  targetName: string,
  author: ChatAuthor,
  ports: ChatTargetPorts
): ChatRouting {
  const target = ports.getByName(targetName);

  if (!target) {
    return fail(ChatErrorReason.PLAYER_NOT_FOUND, targetName);
  }

  if (target.sessionId === author.sessionId) {
    return fail(ChatErrorReason.CANT_WISP_YOURSELF);
  }

  return {
    ok: true,
    delivery: {
      kind: "whisper",
      targetSessionId: target.sessionId,
      // Echo the canonical casing, not what the author typed.
      targetName: target.name,
    },
  };
}

export function resolveRouting(
  destination: ChatDestination,
  author: ChatAuthor,
  ports: ChatTargetPorts
): ChatRouting {
  if (destination.kind === "whisper") {
    return resolveWhisper(destination.targetName, author, ports);
  }

  const { channel } = destination;

  return (
    match(channel)
      .with(ChatChannel.GENERAL, ChatChannel.DATING, () =>
        broadcast(channel, ports.sessionsOnMap(author.mapId))
      )
      .with(
        ChatChannel.TRADE,
        ChatChannel.RECRUITMENT,
        ChatChannel.ALIGNMENT,
        ChatChannel.EVENT,
        () => broadcast(channel, ports.allSessions())
      )
      .with(ChatChannel.TEAM, () => {
        const targets = ports.teamSessions(author.sessionId);

        return targets
          ? broadcast(channel, targets)
          : fail(ChatErrorReason.NOT_IN_FIGHT);
      })
      // Both domains are unimplemented server-side: there is no guild service and
      // no party at all. The channel is wired end to end, so the day either lands
      // only this branch changes.
      .with(ChatChannel.GUILD, () => fail(ChatErrorReason.NO_GUILD))
      .with(ChatChannel.PARTY, () => fail(ChatErrorReason.NO_PARTY))
      // Advice and admin echo to the author alone until moderation exists.
      .otherwise(() => broadcast(channel, [author.sessionId]))
  );
}
