---
id: QA-036
title: Le personnage possède les 2 091 sorts du jeu
severity: P1
domain: world-content
type: data
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-010]
files:
  - apps/gameserver-ts/src/db/migrations/0044_class_starter_spells.ts
  - apps/gameserver-ts/scripts/dev-seed.ts
---

## Symptôme

`select count(*) from player_spells` → **2 091**, soit l'intégralité du
catalogue attribué au personnage de test.

Le serveur reconstruit et renvoie cette liste complète à chaque entrée de map —
`[SpellsService] buildSpellList player=1 spells=2091 … total=30ms`, observé à
chacun des cinq changements de map.

## Cause

`class_starter_spells` est vide (0 ligne) : la table qui devrait définir les
sorts de départ par classe n'est pas seedée, et le seed compense en donnant
tout.

## Correctif

La migration 0044 seede `class_starter_spells` depuis les bundles 1.29
(`classes.json` `G[classe].s` croisé avec le `minPlayerLevel` de `spells.json`) :
3 sorts par classe, 36 lignes, conformes au 1.29 — un Iop démarre avec Pression,
Bond, Intimidation. `dev-seed.ts` remplace désormais le carnet de sorts par ces
trois-là au lieu de recopier `spell_templates`.

## Vérification

`[SpellsService] buildSpellList player=1 spells=3 … total=4ms`.

## À part — migration 0037

Les plages `BREED_RANGES` de la migration 0037 sont **fausses** : ce sont des
plages 2.x. En 1.29, 101-111 est Ecaflip, pas Iop ; les sorts Féca sont 3-20.
La migration 0037 ne repositionne donc rien de juste.

Non corrigée ici : elle a déjà tourné, et 0044 ne dépend pas d'elle.
