import { loginActor } from "@/game/machines/actors";
import type { MessageHandler } from "@/game/network/message-handler";
import type {
  AccountCharactersList,
  AccountCharacterSelected,
  AccountLoginResponse,
  AccountSelectServer,
  AccountServersList,
  HandshakeConnectionKey,
} from "@/game/network/protocol";
import { createLogger } from "@/utils/logger";

const log = createLogger("AuthHandler");

export interface AuthHandlerState {
  connectionKey: string | null;
  ticket: string | null;
  selectedCharacter: AccountCharacterSelected | null;
}

/**
 * Handles the pre-game protobuf flow:
 *   HandshakeConnectionKey (ignored — PBKDF2 replaces Vigenere)
 *   AccountLoginResponse   → AUTH_SUCCESS / AUTH_FAILURE
 *   AccountServersList     → SERVERS_RECEIVED
 *   AccountSelectServer    → SERVER_SELECTED
 *   AccountCharactersList  → CHARACTERS_RECEIVED
 *   AccountCharacterSelected → CHARACTER_LOADED
 */
export class AuthHandler {
  private state: AuthHandlerState = {
    connectionKey: null,
    ticket: null,
    selectedCharacter: null,
  };

  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  getState(): Readonly<AuthHandlerState> {
    return this.state;
  }

  private register(): void {
    this.messageHandler.on(
      "handshakeConnectionKey",
      (payload: HandshakeConnectionKey) => {
        this.state.connectionKey = payload.connectionKey;
        log.debug("Handshake key received");
      }
    );

    this.messageHandler.on(
      "accountLogin",
      (payload: AccountLoginResponse) => {
        if (payload.success) {
          log.info("Login OK");
          loginActor.send({ type: "AUTH_SUCCESS" });
          return;
        }
        const reason = describeLoginError(payload);
        log.warn("Login failed:", reason);
        loginActor.send({ type: "AUTH_FAILURE", reason });
      }
    );

    this.messageHandler.on(
      "accountServersList",
      (payload: AccountServersList) => {
        log.info(`Servers: ${payload.servers.length}`);
        loginActor.send({
          type: "SERVERS_RECEIVED",
          servers: payload.servers,
        });
      }
    );

    this.messageHandler.on(
      "accountSelectServer",
      (payload: AccountSelectServer) => {
        if (!payload.success) {
          const reason = payload.errorCode || "server-select-failed";
          log.warn("Server select failed:", reason);
          loginActor.send({ type: "AUTH_FAILURE", reason });
          return;
        }
        this.state.ticket = payload.ticket;
        log.info(`Server selected, ticket acquired`);
        loginActor.send({ type: "SERVER_SELECTED" });
      }
    );

    this.messageHandler.on(
      "accountCharactersList",
      (payload: AccountCharactersList) => {
        log.info(`Characters: ${payload.characters.length}`);
        loginActor.send({
          type: "CHARACTERS_RECEIVED",
          characters: payload.characters,
        });
      }
    );

    this.messageHandler.on(
      "accountCharacterSelected",
      (payload: AccountCharacterSelected) => {
        if (!payload.success) {
          log.warn("Character selection failed");
          loginActor.send({
            type: "AUTH_FAILURE",
            reason: "character-select-failed",
          });
          return;
        }
        this.state.selectedCharacter = payload;
        log.info(`Character loaded: ${payload.characterName}`);
        loginActor.send({ type: "CHARACTER_LOADED" });
      }
    );
  }
}

function describeLoginError(payload: AccountLoginResponse): string {
  switch (payload.errorCode) {
    case "v":
      return `version mismatch (required: ${payload.requiredVersion})`;
    case "k":
      return payload.kickMessage || payload.kickTitle || "account kicked";
    case "":
      return "unknown error";
    default:
      return `error code: ${payload.errorCode}`;
  }
}
