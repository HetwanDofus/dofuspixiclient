---
id: QA-111
title: Ni inventaire de monture, ni étable, ni enclos
severity: P3
domain: exchange
type: feature
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-101, QA-102, QA-103]
files:
  - apps/gameserver-ts/src/core/shared/db/schema.ts:881
  - assets/sources/client-code/dofus/aks/Exchange.as:495
---

## Symptôme

`mount_paddocks` et `mount_paddock_data` existent et comptent 0 ligne ; aucune
requête ne les touche. `MountPanel.tsx` est une maquette.

## Attendu (1.29)

Deux types, que l'énumération actuelle attribue tous les deux à autre chose
(QA-103) :

- **15** — `Storage{isMount:true}` (`Exchange.as:495-499`) : l'inventaire de la
  dromadaire. C'est **la même fenêtre que la banque**, avec la barre de pods
  visible (elle est masquée pour la banque, `Storage.as:56-61`) et alimentée par
  la trame **`Ew<pods>;<podsMax>`**. Le seul appelant est le bouton monture
  (`Mount.as:119`, `Banner.as:927`).
- **16** — `MountStorage` : étable et enclos, avec `Ee` et `Ef` pour les
  transferts, et une charge utile `<montures>~<montures d'enclos>`.

## Correctif

`owner_kind = Mount` et `owner_kind = Paddock`. Le type 15 est le moins cher de
tous les types restants une fois QA-086 livré : c'est le `StorageFlow` avec un
propriétaire différent et une limite de pods à faire respecter côté serveur —
le client ne l'applique que pour la monture, jamais pour la banque.

## Reste à faire

Non engagé.
