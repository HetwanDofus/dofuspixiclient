import { FightStartModule } from "@features/game/fight-start/fight-start.module";
import { MoveAckHandler } from "@features/game/move-ack/move-ack.handler";
import { MapsModule } from "@modules/maps/maps.module";
import { MonstersModule } from "@modules/monsters/monsters.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { ScriptedCellsModule } from "@modules/scripted-cells/scripted-cells.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [
    PlayersModule,
    PlayerPresenceModule,
    MapsModule,
    ScriptedCellsModule,
    MonstersModule,
    FightStartModule,
  ],
  providers: [MoveAckHandler],
})
export class MoveAckModule {}
