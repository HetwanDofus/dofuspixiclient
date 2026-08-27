import { ChatFloodService } from "@features/game/chat/chat.flood.service";
import { ChatHandler } from "@features/game/chat/chat.handler";
import { FightModule } from "@modules/fight/fight.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayerPresenceModule, FightModule],
  providers: [ChatHandler, ChatFloodService],
})
export class ChatModule {}
