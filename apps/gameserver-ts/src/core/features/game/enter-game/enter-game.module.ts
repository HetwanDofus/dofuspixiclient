import { EnterGameHandler } from "@features/game/enter-game/enter-game.handler";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { MapsModule } from "@modules/maps/maps.module";
import { MonstersModule } from "@modules/monsters/monsters.module";
import { NpcsModule } from "@modules/npcs/npcs.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { ShortcutsModule } from "@modules/shortcuts/shortcuts.module";
import { SpellsModule } from "@modules/spells/spells.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [
    InventoryModule,
    MapsModule,
    MonstersModule,
    NpcsModule,
    PlayersModule,
    PlayerPresenceModule,
    StatsModule,
    SpellsModule,
    ShortcutsModule,
  ],
  providers: [EnterGameHandler],
})
export class EnterGameModule {}
