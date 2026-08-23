---
id: QA-060
title: Aucun butin d'objets en fin de combat
severity: P1
domain: fight
type: gap
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-059, QA-035, QA-013]
files:
  - apps/gameserver-ts/src/core/modules/fight/engine/fight.end.service.ts
  - apps/gameserver-ts/src/core/modules/inventory/inventory.repository.ts
---

## Symptôme

Un combat gagné ne donne aucun objet.

## Cause

`FightEndService` ne consulte jamais `monster_drops`. La table est pourtant
peuplée — **4 562 lignes** importées par `just import-content`, avec
`itemTemplateId`, `rate`, `minQuantity`, `maxQuantity` — et **elle n'est lue par
aucun fichier du serveur**.

Le calcul du bonus de butin des défis existe déjà (`challengeDropBonus`), il est
appliqué… aux kamas uniquement, faute de butin à moduler.

## Portée — c'est le premier `insert` d'objet du projet

`InventoryRepository` sait déplacer, supprimer et compter des objets, mais
**n'a aucune méthode d'insertion**, et rien nulle part n'écrit dans
`player_items`. Cette entrée est donc à la fois un correctif de combat et
l'ouverture du robinet des objets, dont dépendent QA-013 (inventaire),
QA-035 (marchands) et tout le reste de l'économie.

Ajouter une méthode d'insertion avec sa transaction, et l'utiliser ici.

## Correctif

Tirer les drops de chaque monstre vaincu selon `rate` (pondéré par la
prospection du joueur, conformément au 1.29), appliquer `challengeDropBonus`,
insérer dans `player_items` dans **une seule transaction avec la distribution
d'XP et de kamas** — un combat qui échoue à mi-chemin ne doit pas laisser un
joueur avec les objets mais sans l'XP.

## Vérification

Voir le runbook du sprint 01, étape « Boucle de récompense ».
