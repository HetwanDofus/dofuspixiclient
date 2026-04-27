import { FightPlacementHandler } from "@features/game/fight-placement/fight-placement.handler";
import { Module } from "@nestjs/common";

@Module({
  providers: [FightPlacementHandler],
})
export class FightPlacementModule {}
