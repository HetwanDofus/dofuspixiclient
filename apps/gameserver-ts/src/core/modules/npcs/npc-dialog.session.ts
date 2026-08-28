import { Injectable } from "@nestjs/common";

export interface OpenDialog {
  npcSpriteId: number;
  templateId: number;
  mapId: number;
  /** The question the player is looking at right now. */
  questionId: number;
}

/**
 * Which session is talking to which NPC.
 *
 * One dialog per session, which is the canonical rule — `NpcDialog` is a
 * singleton UI component, and `Dialog.create` on a second NPC would replace
 * the first without telling the server. Keeping it single-valued here means a
 * stale dialog can never accumulate.
 *
 * `npcsInDialog` exists for the wander tick: an NPC mid-conversation must stop
 * walking, or it strolls out of frame while the player is reading. It is a
 * count, not a flag, because several players can talk to the same NPC.
 */
@Injectable()
export class NpcDialogSessionService {
  private readonly bySession = new Map<string, OpenDialog>();
  private readonly npcTalkers = new Map<number, number>();

  get(sessionId: string): OpenDialog | undefined {
    return this.bySession.get(sessionId);
  }

  open(sessionId: string, dialog: OpenDialog): void {
    this.close(sessionId);
    this.bySession.set(sessionId, dialog);
    this.npcTalkers.set(
      dialog.npcSpriteId,
      (this.npcTalkers.get(dialog.npcSpriteId) ?? 0) + 1
    );
  }

  /** Moves an open dialog to another question. No-op when none is open. */
  advance(sessionId: string, questionId: number): void {
    const open = this.bySession.get(sessionId);
    if (open) {
      this.bySession.set(sessionId, { ...open, questionId });
    }
  }

  /** Returns true when there was a dialog to close. */
  close(sessionId: string): boolean {
    const open = this.bySession.get(sessionId);
    if (!open) {
      return false;
    }

    this.bySession.delete(sessionId);

    const talkers = (this.npcTalkers.get(open.npcSpriteId) ?? 1) - 1;
    if (talkers > 0) {
      this.npcTalkers.set(open.npcSpriteId, talkers);
    } else {
      this.npcTalkers.delete(open.npcSpriteId);
    }

    return true;
  }

  isBusy(npcSpriteId: number): boolean {
    return this.npcTalkers.has(npcSpriteId);
  }
}
