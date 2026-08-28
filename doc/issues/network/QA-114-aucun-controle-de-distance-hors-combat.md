---
id: QA-114
title: Aucun contrôle de distance ni d'adjacence hors combat — on parle à un PNJ depuis l'autre bout de la carte
severity: P2
domain: network
type: gap
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-085, QA-086, QA-065]
files:
  - apps/gameserver-ts/src/core/features/game/npc-dialog/npc-dialog.handler.ts
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.service.ts:43
  - apps/gameserver-ts/src/core/modules/waypoints/waypoints.service.ts
---

## Symptôme

Trois interactions vérifient la **carte** et jamais la **case** :

- `NpcDialogHandler.create` résout le sprite contre la carte du joueur et
  s'arrête là — son propre commentaire le dit : « The sprite id is resolved
  against the player's own map. That is the whole access check. »
- `InteractiveObjectsService.use:43` recharge la carte, vérifie que la cellule
  porte bien un élément et que le modèle offre bien la compétence — mais ne
  compare jamais `placed.cellId` à la cellule visée.
- `WaypointsService.openZaapMenu` ne vérifie que la présence.

Un client modifié peut donc parler, ouvrir un coffre ou emprunter un zaap
depuis n'importe où sur la carte.

## Attendu (1.29)

Le client marche jusqu'à l'élément avant d'agir : `useRessource` appelle
`onCellRelease(mcCell)` d'abord, et le client de ce dépôt le reproduit
(`game-client.ts:1133 approachInteractive`, avec un `flushPendingInteraction`
qui abandonne si la marche s'est terminée ailleurs). Le comportement honnête est
donc déjà là — il n'est simplement pas vérifié côté serveur.

Nuance : le dialogue PNJ, lui, **ne marche pas** avant d'agir
(`GameManager.startDialog` annule le déplacement et envoie `DC` tout de suite),
donc pour lui la contrainte canonique est une portée, pas une adjacence.

## Correctif

Les primitives existent : `packages/grid/src/neighbors.ts:getNeighbors` pour
l'adjacence, `MapCacheService.load` pour les dimensions, et
`maps.validate-path.ts` comme précédent de style — un refus nommé plutôt qu'une
exception. À ne pas confondre avec `fightDistance`, qui est une distance de
combat et coûte un BFS.

Attention aux faux positifs : c'est la leçon explicite de QA-065 sur la
vérification de vitesse.

## Reste à faire

Non engagé. Volontairement hors du périmètre du sprint S02 : la banque est
protégée par la sérialisation par session, pas par la distance.
