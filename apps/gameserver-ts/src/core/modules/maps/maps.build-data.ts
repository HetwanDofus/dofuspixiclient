import { create } from "@bufbuild/protobuf";
import {
  type GameMapData,
  GameMapDataSchema,
  MapCellSchema,
} from "@dofus/proto/game_pb";
import { decodeCells } from "@modules/maps/maps.cells-codec";

type MapRow = {
  id: number;
  date: string;
  key: string;
  width: number;
  height: number;
  background: number;
  musicId: number | null;
  ambianceId: number | null;
  cells: Uint8Array;
  subareaId: number | null;
};

export function buildMapData(row: MapRow): GameMapData {
  return create(GameMapDataSchema, {
    mapId: row.id,
    mapDate: row.date,
    mapKey: row.key,
    width: row.width,
    height: row.height,
    background: row.background,
    cells: decodeCells(row.cells).map((c) => create(MapCellSchema, c)),
    subareaId: row.subareaId ?? 0,
    musicId: row.musicId ?? 0,
    ambianceId: row.ambianceId ?? 0,
  });
}
