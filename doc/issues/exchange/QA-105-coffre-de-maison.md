---
id: QA-105
title: Le coffre de maison n'a pas de contenant propre
severity: P2
domain: exchange
type: feature
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-101, QA-102]
files:
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.service.ts:146
---

## Symptôme

`InteractiveObjectsService.openStorage:146` distingue déjà le coffre de maison
de la banque — `findHouseByInteriorMap` décide, `HOUSE_STORAGE_SLOTS` vaut 100 —
mais rien ne peut y entrer ni en sortir. `house_storage_items` compte 0 ligne et
n'est lue que par un `COUNT(*)`.

## Attendu (1.29)

Même type d'échange que la banque (5, `Storage`), même protocole `EC`/`EL`/`Es`/`EV`.
Ce qui change est le propriétaire du contenant et les droits d'accès.

## Correctif

`owner_kind = House`, `owner_id = houses.id`, réutilisation du `StorageFlow` de
QA-086. Reste à trancher : les droits (`houses.owner_id`, `houses.locked`, le
code de coffre — le message `sX` / `StorageLocked` existe déjà au proto et n'est
émis par personne).

## Reste à faire

Non engagé. Dépend de QA-086 livré.
