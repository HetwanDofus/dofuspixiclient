---
id: QA-110
title: Aucun ramassage de percepteur
severity: P3
domain: exchange
type: feature
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-101, QA-102]
files:
  - apps/gameserver-ts/src/core/shared/db/schema.ts:777
---

## Symptôme

`guild_tax_collectors` existe (`schema.ts:777` — `guildId, mapId, cellId, kamas,
items, spawnedAt, n1, n2, xpAccumulated`) et compte 0 ligne. Aucune écriture,
aucune lecture. Le panneau de guilde affiche déjà un onglet « Percepteurs »
(`GuildPanel.tsx:31`) sans rien derrière.

## Attendu (1.29)

Type 8 → `ECK8<spriteId>` → `TaxCollectorStorage` (`Exchange.as:427-433`). Le
menu contextuel n'offre « Récolter » qu'aux membres de la guilde qui en ont le
droit (`DofusBattlefield.as:791`, l'entrée est conditionnée). Le contenu est le
butin accumulé par le percepteur.

## Correctif

`owner_kind = TaxCollector`. La particularité par rapport à la banque est la
liste de contrôle d'accès : c'est le premier contenant dont le propriétaire
n'est ni un compte ni un personnage, et dont les droits se lisent dans
`guild_members` / `guild_ranks`.

## Reste à faire

Non engagé. Suppose un système de guilde vivant, qui n'existe pas non plus.
