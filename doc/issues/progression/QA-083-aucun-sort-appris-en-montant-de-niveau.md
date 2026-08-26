---
id: QA-083
title: Aucun sort n'est appris en montant de niveau, et un combat ne fait gagner qu'un seul niveau
severity: P1
domain: progression
type: gap
status: fixed
session: 1
opened: 2026-08-24
closed:
fixed_in:
related: [QA-036]
files:
  - apps/gameserver-ts/migrations/0048_class_spells.ts
  - apps/gameserver-ts/src/core/modules/players/players.progression.service.ts
  - apps/gameserver-ts/src/core/modules/players/players.progression.constants.ts
  - apps/gameserver-ts/src/core/modules/players/players.capital.ts
  - apps/gameserver-ts/scripts/set-level.ts
  - apps/gameserver-ts/src/core/modules/spells/spells.service.ts
  - apps/gameserver-ts/src/core/modules/fight/engine/fight.end.service.ts
  - apps/gameserver-ts/src/core/features/game/enter-game/enter-game.handler.ts
  - apps/gameserver-ts/scripts/dev-seed.ts
  - dofus-bot-manager/src/core/db/seeder.ts
---

## Symptôme

Le personnage de test `Dev`, **niveau 101**, connaît **3 sorts** :

```
select count(*) from player_spells where player_id = 1;  →  3
```

Ce sont exactement les trois sorts de départ Féca (Glyphe Agressif, Attaque
Naturelle, Armure Terrestre). Les dix-sept autres, dont Bouclier Féca (niveau
80) et Glyphe de Silence (niveau 100), n'ont jamais été appris.

Même personnage, même origine : **2 points de capital sorts** au lieu de 97
(100 gagnés, 3 dépensés pour monter Glyphe Agressif au niveau 3). Le capital
de caractéristiques, lui, était juste — 500 gagnés − 119 dépensés = 381.

## Attendu (1.29)

Un Féca 101 connaît 20 des 21 sorts de sa classe — tous sauf l'Invocation de
Dopeul, apprise au niveau 200. Il a gagné 5 points de carac et 1 point de sort
par niveau.

## Cause

Deux manques distincts, tous deux « un changement d'état sans conséquence ».

**1. Rien n'apprend de sort.** Aucun chemin du serveur n'insère dans
`player_spells` : `spells.repository.ts` ne sait que faire un `UPDATE` (montée
de niveau d'un sort déjà connu), et les seules écritures du dépôt étaient les
scripts de seed. Le carnet restait donc figé sur ce que le seed avait posé.
La donnée manquante était le *niveau d'apprentissage* : `class_starter_spells`
(migration 0044, correctif de [QA-036](../world-content/QA-036-personnage-possede-tous-les-sorts.md))
ne garde que les sorts de niveau requis 1 et jette les autres.

**2. Un combat ne fait gagner qu'un niveau.** `fight.end.service.ts` testait le
seuil avec un `if`, pas une boucle : un combat rapportant trois niveaux en
accordait un et laissait l'xp en banque. Le seuil `(niveau+1)² × 10` y était
réécrit à la main, en double avec `stats.service.ts`.

## Correctif

- Migration **0048** : table `class_spells (class_id, spell_id, learn_level,
  position)`, 252 lignes (21 × 12 classes) dérivées des bundles 1.29 —
  `classes.json` `G[classe].s` croisé avec `spells.json` `S[id].l1[2]`, la
  même source que 0044, filtre en moins. `class_starter_spells` est supprimée :
  un sort de départ, c'est `learn_level = 1`. La migration rattrape aussi les
  personnages existants (`ON CONFLICT DO NOTHING`, un sort déjà monté garde son
  niveau et son emplacement de barre).
- `PlayersProgressionService` : un seul entonnoir « l'xp a changé, aligne le
  personnage ». Il accorde **tous** les niveaux que l'xp couvre en un seul
  `UPDATE`, puis les sorts qu'ils débloquent. La courbe d'xp est isolée dans
  `players.progression.constants.ts`, lue par le combat et par le panneau.
- `syncSpellBook` à l'entrée en jeu : rattrape un niveau posé à la main en SQL,
  ce qui est la seule façon dont un personnage monte dans ce projet.
- Fin de combat : re-push de `SpellList` et de `As` au joueur qui a pris un
  niveau — ni l'un ni l'autre ne voyage sur `GameEnd`.
- `dev-seed.ts` et le seeder du bot-manager donnent ce que la classe connaît **au
  niveau du personnage**, en ajout et non en réécriture, et ne replacent plus un
  personnage existant sur la case de spawn (`RESET_POSITION=1` pour le demander).
- `scripts/set-level.ts` : poser un niveau à la main devient une opération
  complète — le nombre, l'xp qui le justifie, le capital et les sorts. Le capital
  y est **recalculé** (gagné − dépensé, via `players.capital.ts`) et non crédité,
  donc le script est rejouable : c'est ce qui a réparé les 95 points de sorts
  manquants sans risquer d'en donner deux fois. Volontairement un outil, pas un
  passage à la connexion : la réinitialisation de caractéristiques du 1.29 rend
  du capital, et un recalcul l'effacerait en silence.

## Vérification

```
just db-migrate
docker exec …-postgres-1 psql -U dofus -d dofus \
  -c "select count(*) from player_spells where player_id = 1;"   →  20
```

Rattrapage à la connexion, relevé sur un bot Féca passé à la main au niveau 30 :

```
[SpellsService] learnClassSpells player=16 class=1 level=30 learned=[4, 2, 1, 9, 18, 20, 14]
[SpellsService] buildSpellList player=16 spells=10 …
```

`bun test src/core/modules/players/` — 8 cas, dont « monte tous les niveaux que
l'xp couvre, pas un seul » et « ne redescend jamais un niveau posé à la main ».

**Pas encore rejoué à la main dans le client** : le relevé ci-dessus vient d'un
bot, pas d'une session de jeu.
