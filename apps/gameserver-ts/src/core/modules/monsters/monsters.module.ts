import { MapsModule } from "@modules/maps/maps.module";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { MonstersRepository } from "@modules/monsters/monsters.repository";
import { Module } from "@nestjs/common";

@Module({
  imports: [MapsModule],
  providers: [MonstersRepository, MapMonsterService],
  exports: [MonstersRepository, MapMonsterService],
})
export class MonstersModule {}
