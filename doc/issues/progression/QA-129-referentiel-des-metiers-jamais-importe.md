---
id: QA-129
title: Le référentiel des métiers n'est jamais importé — cinq tables vides depuis la migration 0011
severity: P1
domain: progression
type: data
status: fixed
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-123, QA-130, QA-131, QA-133]
files:
  - apps/gameserver-ts/migrations/0011_progression.ts
  - apps/gameserver-ts/migrations/0008_exchange.ts
  - apps/gameserver-ts/scripts/import-starloco-triggers.ts
  - apps/gameserver-ts/src/core/shared/db/schema.ts
---

## Symptôme

Cinq tables existent, sont typées dans `schema.ts`, et sont vides. Un `grep`
de `jobs`, `player_jobs`, `job_skills`, `job_gatherable_cells` et `recipes`
hors des migrations et de `schema.ts` ne renvoie **rien** : aucun importeur ne
les remplit, aucun service ne les lit.

| Table | Migration | Lignes |
|---|---|---|
| `jobs` | 0011 | 0 |
| `player_jobs` | 0011 | 0 |
| `job_skills` | 0011 | 0 |
| `job_gatherable_cells` | 0011 | 0 |
| `recipes` | 0008 | 0 |

Le contenu, lui, est sur le disque et n'est lu par personne :

- `langs/fr/jobs.json` — 39 métiers (`J[id] = {n, s, g}`) ;
- `langs/fr/skills.json` — 147 compétences, dont **57 de récolte** (celles qui
  portent `i`, l'objet gagné) et **34 de craft** (celles qui portent `cl`) ;
- `langs/fr/crafts.json` — **2 298 recettes** (`CR[objetRésultat] = [[qté, ingrédient]…]`) ;
- `game.sql:jobs_data` — 38 lignes dont la colonne `tools` est **la seule
  source au monde** du lien outil → métier (Bûcheron : `454,8539,1378,…`) ;
- `game.sql:crafts` — les mêmes 2 298 recettes plus 71 entrées 1.39.

Trois valeurs manquaient partout et ont été retrouvées dans les scripts Lua de
StarLoco, que le dépôt n'exploitait pas : `scripts/data/Experience.lua`
(`JobLevelExp`, les 100 valeurs cumulées) et
`scripts/data/skills/job_{lumberjack,miner,farmer,alchemist,fisher}.lua`
(`minLvl`, `itemID`, `xp` des 57 compétences de récolte, et le `toolType` du
métier).

## Attendu (1.29)

Le référentiel est importé de façon idempotente par une étape de
`just import-world`, qui résout et vérifie explicitement chaque valeur, et
signale ses comptes par source, import, rejet et raison. Aucune valeur du
service d'exécution ne descend d'une constante silencieuse.

## Cause

La migration 0011 a posé le schéma d'une passe « progression » (métiers,
quêtes, chasses au trésor, TTG) dont aucune fonctionnalité n'a suivi. Les trois
importeurs existants ne connaissent que les cartes, le contenu et les
déclencheurs.

## Correctif

Nouveau `scripts/import-starloco-jobs.ts` et recette `just import-jobs`,
chaînée dans `import-world` **après** `import-triggers` — elle a besoin de
`interactive_objects_templates`. Précédence des sources, la même règle que les
trois autres importeurs (« les bundles 1.29 gagnent là où ils ont une entrée ») :

| Cible | Source |
|---|---|
| `jobs` | `jobs.json` `J`, moins les 5 doublons parasites à `g:0` (66, 67, 70, 71, 72), comptés au rejet |
| `job_skills` | `skills.json` `SK` ; `kind` déduit de la présence de `i` (récolte), `cl` (craft) ou `f` (forgemagie) |
| `job_skills.min_level`, `.harvest_xp` | `apps/gameserver-ts/data/starloco-job-skills.json`, transcrit des scripts Lua de StarLoco, provenance et révision en tête |
| `job_tools` | `game.sql:jobs_data.tools` |
| `recipes` | `crafts.json` `CR`, `skill_id` résolu par index inverse de `SK.cl` |
| `job_gatherable_cells` | scan des `maps.cells` décodées (`layerObject2Interactive` armé et `IO.d[gfx].t === 1`) |
| `job_gatherable_cells.respawn_seconds` | `interactive_objects_templates.respawn_ms` — les vraies valeurs rétail (Frêne 300 s, Chêne 1 020 s, Orme 7 200 s), et non les `{6000, 10000}` bouchons des scripts Lua |

Migration `0057_jobs_referential.ts` : `jobs` gagne `gfx_id` et
`specialization_of`, `job_skills` gagne `kind`, `harvest_item_id`,
`harvest_xp`, `criteria` et `fm_item_type`, plus la table `job_tools`.

Le script échoue bruyamment sur une compétence de récolte dont l'objet gagné,
le niveau minimum ou l'XP ne se résout pas.

## Vérification

```bash
just import-jobs game.sql && just import-jobs game.sql
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus -tAc \
  "select (select count(*) from jobs), (select count(*) from job_skills),
          (select count(*) from job_tools), (select count(*) from recipes),
          (select count(*) from job_gatherable_cells);"
```

Deux exécutions produisent les mêmes lignes. Attendu : ~39 métiers,
147 compétences dont 57 de récolte, ~2 298 recettes, ~12 226 cellules
récoltables.
