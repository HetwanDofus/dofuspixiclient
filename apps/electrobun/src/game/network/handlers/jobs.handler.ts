import type { MessageHandler } from "@/game/network/message-handler";
import { appendInfoMessage } from "@/game/stores/chat-store";
import {
  handleItemTool,
  handleJobLevel,
  handleJobOptions,
  handleJobRemove,
  handleJobSkills,
  handleJobXp,
} from "@/game/stores/jobs-store";

/**
 * Wires the `J` channel into `jobsStore`.
 *
 * Proto → handler map:
 *   jobSkills → handleJobSkills (JS)
 *   jobXp     → handleJobXp (JX)
 *   jobLevel  → handleJobLevel (JN)
 *   jobOptions → handleJobOptions (JO)
 *   jobRemove → handleJobRemove (JR)
 *   itemTool  → handleItemTool (OT)
 *   infoMessage → the chat (Im)
 *
 * `OT` rides with the jobs rather than with the inventory because nothing in
 * the inventory cares which weapon is a tool — the interactive menu does.
 */
export class JobsHandler {
  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  private register(): void {
    this.messageHandler.on("jobSkills", handleJobSkills);
    this.messageHandler.on("jobXp", handleJobXp);
    this.messageHandler.on("jobLevel", handleJobLevel);
    this.messageHandler.on("jobOptions", handleJobOptions);
    this.messageHandler.on("jobRemove", handleJobRemove);
    this.messageHandler.on("itemTool", handleItemTool);
    // `Im` — the server explaining why nothing happened. It is the only
    // thing that tells a player standing in front of a tree that they are
    // missing an axe rather than looking at a broken game.
    this.messageHandler.on("infoMessage", (payload) => {
      appendInfoMessage(payload.message);
    });
  }
}
