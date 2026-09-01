import { FightChallengeModule } from "@modules/fight/challenges/fight.challenge.module";
import { FightEffectsModule } from "@modules/fight/effects/fight.effects.module";
import { FightEndService } from "@modules/fight/engine/fight.end.service";
import { FightFrameEmitter } from "@modules/fight/engine/fight.frame-emitter";
import { FightHistoryRepository } from "@modules/fight/engine/fight.history.repository";
import { FightLifecycleService } from "@modules/fight/engine/fight.lifecycle.service";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { JobsModule } from "@modules/jobs/jobs.module";
import { MapsModule } from "@modules/maps/maps.module";
import { MonstersModule } from "@modules/monsters/monsters.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { SpellsModule } from "@modules/spells/spells.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  imports: [
    FightEffectsModule,
    FightChallengeModule,
    PlayersModule,
    PlayerPresenceModule,
    MapsModule,
    SpellsModule,
    // For the level-up push at the end of a fight: the new level,
    // capital and life cap ride on the `As` frame, not on `GameEnd`.
    StatsModule,
    MonstersModule,
    InventoryModule,
    JobsModule,
  ],
  providers: [
    FightRegistryService,
    FightEndService,
    FightHistoryRepository,
    FightFrameEmitter,
    FightLifecycleService,
  ],
  exports: [
    FightRegistryService,
    FightEndService,
    FightHistoryRepository,
    FightFrameEmitter,
    FightLifecycleService,
    FightEffectsModule,
    FightChallengeModule,
  ],
})
export class FightModule {}
