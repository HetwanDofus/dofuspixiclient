import { db } from "./database.ts";

/**
 * Seed a representative set of item templates for testing.
 * Run with: bun apps/server/src/db/seed-items.ts
 */

const templates = [
  // ── Weapons ──
  { id: 39, name: "Petite Epée de Boisaille", type: 6, super_type: 2, level: 1, weight: 10, gfx_id: 39, equip_positions: "[1]", effects: '[{"id":100,"min":1,"max":3}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Petite épée en bois" },
  { id: 44, name: "Baguette de Glace", type: 3, super_type: 2, level: 14, weight: 10, gfx_id: 44, equip_positions: "[1]", effects: '[{"id":126,"min":6,"max":10},{"id":123,"min":6,"max":10}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Baguette de Glace" },
  { id: 1542, name: "La Triste Lame", type: 6, super_type: 2, level: 46, weight: 15, gfx_id: 50, equip_positions: "[1]", effects: '[{"id":118,"min":11,"max":20},{"id":125,"min":21,"max":40}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Une lame triste" },

  // ── Hat ──
  { id: 8243, name: "Coiffe du Bouftou", type: 16, super_type: 7, level: 5, weight: 5, gfx_id: 10, equip_positions: "[6]", effects: '[{"id":125,"min":5,"max":10},{"id":124,"min":1,"max":3}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Coiffe en laine de Bouftou" },

  // ── Amulet ──
  { id: 69, name: "Amulette du Bouftou", type: 1, super_type: 1, level: 3, weight: 2, gfx_id: 69, equip_positions: "[0]", effects: '[{"id":125,"min":5,"max":15}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Amulette du Bouftou" },

  // ── Ring ──
  { id: 70, name: "Anneau de Bouze le Clerc", type: 9, super_type: 3, level: 6, weight: 1, gfx_id: 70, equip_positions: "[2,3]", effects: '[{"id":124,"min":1,"max":5},{"id":126,"min":1,"max":5}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Anneau magique" },

  // ── Belt ──
  { id: 111, name: "Ceinture du Bouftou", type: 10, super_type: 4, level: 4, weight: 3, gfx_id: 111, equip_positions: "[4]", effects: '[{"id":125,"min":5,"max":15},{"id":158,"min":10,"max":50}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Ceinture en cuir de Bouftou" },

  // ── Boots ──
  { id: 119, name: "Bottes du Bouftou", type: 11, super_type: 5, level: 5, weight: 5, gfx_id: 119, equip_positions: "[5]", effects: '[{"id":119,"min":1,"max":5},{"id":128,"min":1,"max":1}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Bottes en cuir de Bouftou" },

  // ── Cape ──
  { id: 2411, name: "Cape du Tofu", type: 17, super_type: 8, level: 1, weight: 3, gfx_id: 5, equip_positions: "[7]", effects: '[{"id":125,"min":1,"max":5}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Cape fabriquée à partir de plumes de Tofu" },

  // ── Shield ──
  { id: 8541, name: "Bouclier du Bouftou", type: 82, super_type: 11, level: 5, weight: 10, gfx_id: 10, equip_positions: "[15]", effects: '[{"id":125,"min":5,"max":10}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Bouclier en cuir" },

  // ── Pet ──
  { id: 10000, name: "Petit Chacha Blanc", type: 18, super_type: 9, level: 1, weight: 5, gfx_id: 8004, equip_positions: "[8]", effects: '[{"id":125,"min":10,"max":20}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Un petit Chacha blanc" },

  // ── Consumables ──
  { id: 548, name: "Pain d'Amakna", type: 33, super_type: 12, level: 1, weight: 1, gfx_id: 10, equip_positions: "[]", effects: '[{"id":108,"min":20,"max":30}]', item_set_id: 0, two_handed: false, usable: true, stackable: true, description: "Restaure des points de vie" },
  { id: 468, name: "Petite Potion de Vie", type: 12, super_type: 12, level: 1, weight: 1, gfx_id: 1, equip_positions: "[]", effects: '[{"id":108,"min":50,"max":50}]', item_set_id: 0, two_handed: false, usable: true, stackable: true, description: "Restaure 50 points de vie" },

  // ── Resources ──
  { id: 289, name: "Laine de Bouftou", type: 57, super_type: 13, level: 1, weight: 2, gfx_id: 1, equip_positions: "[]", effects: "[]", item_set_id: 0, two_handed: false, usable: false, stackable: true, description: "Laine récoltée sur un Bouftou" },
  { id: 473, name: "Bois de Frêne", type: 38, super_type: 13, level: 1, weight: 3, gfx_id: 1, equip_positions: "[]", effects: "[]", item_set_id: 0, two_handed: false, usable: false, stackable: true, description: "Un morceau de Bois de Frêne" },
  { id: 312, name: "Fer", type: 39, super_type: 13, level: 1, weight: 5, gfx_id: 108, equip_positions: "[]", effects: "[]", item_set_id: 0, two_handed: false, usable: false, stackable: true, description: "Un morceau de Fer brut" },
  { id: 313, name: "Cuivre", type: 39, super_type: 13, level: 10, weight: 5, gfx_id: 109, equip_positions: "[]", effects: "[]", item_set_id: 0, two_handed: false, usable: false, stackable: true, description: "Un morceau de Cuivre" },

  // ── Dofus ──
  { id: 694, name: "Dofus Pourpre", type: 23, super_type: 10, level: 6, weight: 1, gfx_id: 1, equip_positions: "[9,10,11,12,13,14]", effects: '[{"id":125,"min":30,"max":50},{"id":118,"min":10,"max":20}]', item_set_id: 0, two_handed: false, usable: false, stackable: false, description: "Un Dofus légendaire" },
];

async function seed() {
  console.log("Seeding item templates...");

  for (const t of templates) {
    await db
      .insertInto("item_templates")
      .values(t)
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }

  console.log(`Seeded ${templates.length} item templates.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
