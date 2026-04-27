import { ChatHandler } from "@features/game/chat/chat.handler";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayerPresenceModule],
  providers: [ChatHandler],
})
export class ChatModule {}
