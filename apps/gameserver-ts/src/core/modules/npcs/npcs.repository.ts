import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class NpcsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /**
   * Every NPC standing on a map, placement joined to its template.
   *
   * `scripted_npcs.template_id` is not a foreign key (see migration 0001), so
   * the join is what filters out placements whose template the dump never
   * described — an inner join is the guard.
   *
   * Ordered by placement id so two calls hand back the same sprite ids in the
   * same order; the index `idx_scripted_npcs_map` (migration 0051) is what
   * keeps this off a sequential scan.
   */
  onMap(mapId: number) {
    return this.txHost.tx
      .selectFrom("scriptedNpcs")
      .innerJoin("npcTemplates", "npcTemplates.id", "scriptedNpcs.templateId")
      .where("scriptedNpcs.mapId", "=", mapId)
      .orderBy("scriptedNpcs.id")
      .select([
        "scriptedNpcs.id as placementId",
        "scriptedNpcs.cellId as cellId",
        "scriptedNpcs.direction as direction",
        "scriptedNpcs.isMovable as isMovable",
        "npcTemplates.id as templateId",
        "npcTemplates.name as name",
        "npcTemplates.gfx as gfx",
        "npcTemplates.sex as sex",
        "npcTemplates.color1 as color1",
        "npcTemplates.color2 as color2",
        "npcTemplates.color3 as color3",
        "npcTemplates.accessories as accessories",
        "npcTemplates.scaleX as scaleX",
        "npcTemplates.scaleY as scaleY",
        "npcTemplates.extraClip as extraClip",
        "npcTemplates.customArtwork as customArtwork",
        "npcTemplates.initialQuestion as initialQuestion",
        "npcTemplates.path as path",
      ])
      .execute();
  }
}
