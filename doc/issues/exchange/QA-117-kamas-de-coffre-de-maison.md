---
id: QA-117
title: Les kamas d'un coffre de maison ne se transfèrent pas — seuls le joueur et la banque étaient reconnus
severity: P1
domain: exchange
type: bug
status: fixed
session: 6
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-101, QA-105]
files:
  - apps/gameserver-ts/migrations/0054_container_kamas.ts
  - apps/gameserver-ts/src/core/modules/items/container-kamas.repository.ts
  - apps/gameserver-ts/src/core/modules/items/kamas-transfer.service.ts
---

## Symptôme

Relevé manette en main : dans un coffre de **maison**, la fenêtre affiche bien
« Vous 16 281 K » et « Coffre 0 K », mais les boutons « Déposer » et
« Retirer » ne font rien. Aucune erreur à l'écran.

## Cause

`KamasTransferService.isKamasHolder` n'acceptait que `OwnerKind.Player` et
`OwnerKind.Bank`. Un coffre de maison est `OwnerKind.House`, donc tout transfert
partait en `unsupported-owner` — un refus silencieux, comme tous les refus de ce
serveur.

Derrière ce test, une décision de schéma : `account_banks` ne savait répondre
qu'à « combien de kamas ce **compte** détient-il ». Un coffre n'avait aucun
endroit où en poser.

C'était un choix assumé au moment d'écrire QA-086 — « un coffre de maison ne
détient pas de kamas, seule la banque en détient » — et il est faux. Le client
1.29 affiche un solde des deux côtés de la fenêtre `Storage` quel que soit le
contenant : `showKamas` n'est mis à `false` que pour une monture
(`dofus/graphics/gapi/ui/Storage.as:101-105`).

## Correctif

Migration 0054 : `account_banks` devient
`container_kamas(owner_kind, owner_id, kamas)`, clé primaire composite,
`CHECK (kamas >= 0)` — exactement la clé de `items`, et pour la même raison. Un
contenant de plus est une ligne de plus, pas une table de plus : le mode
marchand et le percepteur en détiendront aussi.

`BankKamasRepository` devient `ContainerKamasRepository` et prend un `ItemOwner`.
`KamasTransferService` n'a plus qu'une seule distinction — la bourse d'un
personnage est `players.kamas`, tout le reste est une ligne de
`container_kamas` — et `unsupported-owner` disparaît de ses motifs de refus.

Test d'intégration « a house chest holds kamas too » : déposer 300, les
reprendre, solde à zéro des deux bouts.

## Vérification

`bun run test:integration` — 42 verts. Le core démarre sans erreur.
