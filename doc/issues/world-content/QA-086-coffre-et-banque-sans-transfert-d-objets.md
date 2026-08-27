---
id: QA-086
title: Coffre et banque s'ouvrent mais ne transfèrent aucun objet
severity: P2
domain: world-content
type: gap
status: open
session: 2
opened: 2026-08-25
closed:
fixed_in:
related: [QA-085]
files:
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.service.ts
  - proto/exchange.proto
  - proto/world.proto
---

## Symptôme

Cliquer « Ouvrir » sur un coffre déclenche bien l'action et le serveur répond
`StorageInformations` (`sI`) avec la taille du rangement, mais aucune fenêtre ne
s'ouvre côté client et aucun objet ne peut être déplacé.

## Attendu (1.29)

`sI` n'est que l'annonce de la taille. Le contenu et les déplacements passent
par le protocole d'échange : `EC` (ouverture), `EMO` / `EMG` (objet / kamas),
`EK` (validation), `EV` (fermeture).

## Cause

QA-085 a câblé la compétence 104 jusqu'au bon rangement — `house_storage_items`
quand la carte appartient à une maison, `account_bank_items` sinon — et s'est
arrêté là. Le protocole d'échange n'est implémenté par aucun handler serveur
(`grep ExchangeCreate apps/gameserver-ts/src` ne renvoie rien) et le client n'a
ni handler entrant ni fenêtre de coffre.

C'est une fonctionnalité à part entière, pas un oubli de câblage : elle
supposerait le protocole d'échange complet, réutilisé plus tard par le commerce
entre joueurs et les hôtels de vente.

## Correctif

Non engagé.
