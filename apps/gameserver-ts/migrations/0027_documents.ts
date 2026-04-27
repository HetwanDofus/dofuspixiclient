import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("document_templates")
    .addColumn("id", sql`VARCHAR(64)`, (col) => col.primaryKey())
    .addColumn("title", sql`VARCHAR(255)`)
    .addColumn("body", "text", (col) => col.defaultTo(""))
    .addColumn("category", "smallint", (col) => col.defaultTo(0))
    .execute();

  await sql`
    INSERT INTO document_templates (id, title, body, category) VALUES
    ('410', 'Livre du Bwork Mage', '', 0),
    ('966', 'Manuel du Tailleur', '', 0),
    ('1512', 'La Legende de Crocoburio', '', 0),
    ('1567', 'La foret des Abraknydes', '', 0),
    ('1572', 'Creation d''objet magique pour les nuls', '', 0),
    ('1625', 'La legende du Croqueur', '', 0),
    ('1626', 'Encyclopedie d''Alchimie Annexe A : Metiers', '', 0),
    ('1635', 'Parchemin Vent de panique', '', 0),
    ('1715', 'Le don de Nouwel', '', 0),
    ('1716', 'La famille DuCiel', '', 0),
    ('1717', 'Premier Noel', '', 0),
    ('2091', 'Le Bwak : Bien l''elever', '', 0),
    ('2092', 'Le Chacha : Bien l''elever', '', 0),
    ('2093', 'Le Wabbit : Bien l''elever', '', 0),
    ('2111', 'L''ame du pecheur', '', 0),
    ('2112', 'L''ame du chasseur', '', 0),
    ('2173', 'Les secrets du langage ecureuil', '', 0),
    ('2337', 'Livre Magique', '', 0),
    ('2338', 'Vieux Bouquin', '', 0),
    ('7179', 'Route et Chemin : Foret Maudite', '', 0)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("document_templates").ifExists().execute();
}
