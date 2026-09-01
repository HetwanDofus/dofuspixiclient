import { NpcDialogHandler } from "@features/game/npc-dialog/npc-dialog.handler";
import { ExchangeModule } from "@modules/exchange/exchange.module";
import { FightModule } from "@modules/fight/fight.module";
import { JobsModule } from "@modules/jobs/jobs.module";
import { NpcsModule } from "@modules/npcs/npcs.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [
    FightModule,
    NpcsModule,
    PlayerPresenceModule,
    ExchangeModule,
    JobsModule,
  ],
  providers: [NpcDialogHandler],
})
export class NpcDialogModule {}
