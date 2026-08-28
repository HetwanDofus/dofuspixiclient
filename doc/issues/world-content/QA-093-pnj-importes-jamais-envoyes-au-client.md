---
id: QA-093
title: Les PNJ sont en base mais aucun ne parvient au client
severity: P1
domain: world-content
type: gap
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-035, QA-097, QA-098, QA-099, QA-100]
files:
  - apps/gameserver-ts/src/core/modules/npcs/map-npc.service.ts
  - apps/gameserver-ts/src/core/modules/npcs/map-npc.sprite-entry.ts
  - apps/gameserver-ts/src/core/modules/npcs/npcs.repository.ts
  - apps/gameserver-ts/src/core/features/game/enter-game/enter-game.handler.ts
  - apps/gameserver-ts/migrations/0051_npc_scale.ts
  - apps/electrobun/src/game/network/handlers/map.handler.ts
  - apps/electrobun/src/game/lang/npc-lang.ts
  - apps/electrobun/src/game/scene/battlefield/picking.ts
---

## Symptôme

Le monde est vide de marchands et de donneurs de quête. `npc_templates` compte
763 lignes et `scripted_npcs` 803 placements — les données sont là depuis
[QA-035](QA-035-aucun-pnj-aucun-objet-en-base.md) — mais aucun sprite de PNJ
n'apparaît sur aucune map. Astrub (7411) doit montrer *Unkouy Nak* en 350 et
n'en montre rien.

## Attendu (1.29)

Le paquet GM porte une entrée `-4` par PNJ posé sur la map, avec gfx, échelle,
case, orientation, sexe, les trois couleurs, les accessoires et l'id de
template (`dofus/aks/extend/GameIn.as:276-292`). Au clic, le client ouvre la
bulle d'action construite depuis le bundle `npc`
(`DofusBattlefield.as:520-561`).

## Cause

Aucun service serveur ne lisait les deux tables. `SPRITE_TYPE_NPC = 4` et
`SpriteMovementEntry.npc_id` existaient dans le protobuf depuis toujours, mais
rien ne les remplissait, et `enter-game` ne concaténait que les joueurs et les
groupes de monstres.

Deux manques annexes : `npc_templates` n'avait pas de colonne `scale_x` /
`scale_y` alors que l'importeur lisait déjà les champs du dump et les jetait, et
`scripted_npcs` n'avait aucun index sur `map_id`.

## Correctif

Un module `npcs` calqué sur `monsters` (dépôt, service par map, constructeur
d'entrée sprite), une ligne de plus dans `enter-game.handler`, et côté client
une branche `spriteType === 4` plus le chargeur de bundle `npc-lang.ts`.

Les ids de sprite des PNJ sont dérivés de `scripted_npcs.id` sous
`-100_000_000` : stables d'une entrée de map à l'autre, et hors de portée des
joueurs (positifs), des groupes de monstres (à partir de -1) et des combattants
monstres (à partir de -1 000 000).

Les accessoires du dump sont des **ids d'objets en hexadécimal** séparés par des
virgules, l'ordinal étant la position dans la liste — comme les lit
`CharactersManager.setSpriteAccessories`. Ils sont résolus en `(type, gfx)` via
`item_templates`.

Les dialogues et les boutiques restent hors périmètre : la bulle d'action liste
les actions du PNJ mais toutes sont grisées, ce qui est le rendu canonique d'une
action indisponible.

## Vérification

`bun test src/core/modules/npcs/` (6 cas : espace d'ids, stabilité, décodage
hexa des accessoires, échelle nulle). En jeu : *Unkouy Nak* visible en 7411:350
avec casque, cape et bouclier, son nom au survol, « Parler » grisé au clic.
