import { MapsModule } from "@modules/maps/maps.module";
import { ScriptedCellsRepository } from "@modules/scripted-cells/scripted-cells.repository";
import { ScriptedCellsService } from "@modules/scripted-cells/scripted-cells.service";
import { WaypointsModule } from "@modules/waypoints/waypoints.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [MapsModule, WaypointsModule],
  providers: [ScriptedCellsRepository, ScriptedCellsService],
  exports: [ScriptedCellsService],
})
export class ScriptedCellsModule {}
