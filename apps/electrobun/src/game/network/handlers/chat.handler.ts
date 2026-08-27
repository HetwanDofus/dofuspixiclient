import type { ChatMessage, ChatMessageError } from "@dofus/proto/chat_pb";
import { create } from "@bufbuild/protobuf";
import { ChatErrorReason, ChatSendMessageSchema } from "@dofus/proto/chat_pb";
import { ChatChannel } from "@dofus/proto/common_pb";

import type { Connection } from "@/game/network/connection";
import type { MessageHandler } from "@/game/network/message-handler";
import { styleFor } from "@/game/chat/chat-channels";
import { encodeClient } from "@/game/network/protocol";
import {
  appendChatMessage,
  appendErrorMessage,
  armCooldown,
  isFilterVisible,
  setCooldown,
} from "@/game/stores/chat-store";

/**
 * Chat round trip.
 *
 *   client → server  chatSendMessage    (BM<destination>|<message>)
 *   server → client  chatMessage        (cM)
 *   server → client  chatMessageError   (cMK, author only)
 *
 * The handler also drives the speech bubble, because the rule for showing one is
 * a chat rule, not a rendering one: general channel, out of combat, and only
 * while the "messages" filter is checked (dofus/aks/Chat.as:381-386).
 */
export class ChatHandler {
  constructor(
    private readonly messageHandler: MessageHandler,
    private readonly connection: Connection,
    private readonly showBubble: (senderId: string, text: string) => void
  ) {
    this.register();
  }

  private register(): void {
    this.messageHandler.on("chatMessage", (msg) => this.onMessage(msg));
    this.messageHandler.on("chatMessageError", (msg) => this.onError(msg));
  }

  /** Sends a line. `destination` is a channel letter or a player name. */
  send(destination: string, message: string): void {
    this.connection.send(
      encodeClient(
        "chatSendMessage",
        create(ChatSendMessageSchema, { destination, message, itemsData: "" })
      )
    );
  }

  private onMessage(msg: ChatMessage): void {
    const style = styleFor(msg.channel);

    appendChatMessage({
      channel: msg.channel,
      filter: style.filter,
      time: new Date().toTimeString().slice(0, 5),
      player: msg.senderName,
      text: msg.message,
    });

    if (msg.channel === ChatChannel.GENERAL && isFilterVisible(style.filter)) {
      this.showBubble(msg.senderId, msg.message);
    }
  }

  private onError(msg: ChatMessageError): void {
    if (msg.reason === ChatErrorReason.FLOOD) {
      // Realign on the server's clock, then say what it said.
      setCooldown(msg.channel, msg.remainingSeconds);
    }

    appendErrorMessage(describeError(msg));
  }

  /** Arms the local cooldown mirror after a send the client let through. */
  noteSent(channel: ChatChannel): void {
    armCooldown(channel);
  }
}

/**
 * Wording taken from the retail FR bundle (`public/assets/langs/fr/lang.json`):
 * INFOS_115, USER_NOT_CONNECTED, CANT_WISP_YOURSELF.
 */
function describeError(msg: ChatMessageError): string {
  switch (msg.reason) {
    case ChatErrorReason.FLOOD:
      return `Ce canal est restreint pour améliorer sa lisibilité. Vous pourrez envoyer un nouveau message dans ${msg.remainingSeconds} secondes.`;
    case ChatErrorReason.PLAYER_NOT_FOUND:
      return `Le joueur ${msg.detail} n'est pas connecté.`;
    case ChatErrorReason.CANT_WISP_YOURSELF:
      return "Tu ne peux pas t'écrire à toi-même.";
    case ChatErrorReason.NO_GUILD:
      return "Vous n'avez pas de guilde.";
    case ChatErrorReason.NO_PARTY:
      return "Vous n'êtes pas dans un groupe.";
    case ChatErrorReason.NOT_IN_FIGHT:
      return "Ce canal n'est utilisable qu'en combat.";
    default:
      return "Votre message n'a pas pu être envoyé.";
  }
}
