---
id: QA-076
title: La table des positions d'équipement était fausse, dans trois fichiers différents
severity: P1
domain: inventory
type: bug
status: fixed
session: 3
opened: 2026-08-23
closed:
fixed_in:
related: [QA-013, QA-015]
files:
  - packages/protocol/src/item-types.ts
  - apps/gameserver-ts/src/core/modules/inventory/accessories.service.ts
  - apps/gameserver-ts/src/core/features/game/item-move/item-move.handler.ts
---

## Symptôme

La référence 1.29 des positions d'équipement — `I.ss` (superType → positions
légales) dans `assets/langs/fr/items.json` — donne : `0` amulette, `1` arme,
`2` anneau, `3` ceinture, `4` anneau, `5` bottes, `6` coiffe, `7` cape,
`8` familier, `9-14` dofus, `15` bouclier, `16` dragodinde. Trois endroits du
code s'en écartaient, chacun à sa façon :

- `packages/protocol/src/item-types.ts` — `EquipmentPosition` inversait
  ceinture et second anneau (`RING_RIGHT: 3, BELT: 4`) et n'avait pas de
  valeur pour la monture.
- `accessories.service.ts` — `positionToOrdinal` mappait coiffe/cape/
  familier/bouclier sur `5/6/7/14` au lieu de `6/7/8/15` : un joueur
  équipant une coiffe la voyait apparaître en cape sur son personnage.
- `item-move.handler.ts` — acceptait n'importe quelle position `0..15` pour
  n'importe quel objet ; rien n'empêchait d'équiper une potion dans le slot
  bouclier.

## Cause

Aucune des trois n'avait jamais été vérifiée contre le bundle 1.29 en dépôt —
`item-types.ts` citait `EquipmentPosition.java`/`Inventory.as:508`, des
fichiers qui ne sont pas dans ce repo.

## Correctif

`EquipmentPosition` et un nouveau `ItemSuperType` (aligné sur `I.t`) dans
`item-types.ts` sont maintenant dérivés de `I.ss`/`I.t`, avec un commentaire
qui pointe vers cette source vérifiable. `accessories.service.ts` reprend les
bonnes positions. `item-move.handler.ts` est remplacé par
`InventoryService.equip`, qui valide la position contre
`item_super_types.positions` (nouvelle table, migration 0047, remplie par
l'importeur depuis `I.ss`) avant tout déplacement.

## Vérification

En jeu : équiper une coiffe et vérifier qu'elle s'affiche en coiffe sur le
personnage (pas en cape) ; tenter d'équiper une ressource dans un slot
d'équipement et vérifier le refus. Testé à la main dans le client web le
2026-08-23 : coiffe/cape/familier/bouclier s'affichent chacun dans leur
propre slot, une ceinture va bien en position 3 et un second anneau en
position 4.
