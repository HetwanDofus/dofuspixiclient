---
id: QA-106
title: Aucune boutique PNJ — le catalogue n'est même pas importé
severity: P2
domain: exchange
type: feature
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-101, QA-102, QA-093]
files:
  - apps/gameserver-ts/scripts/import-starloco-content.ts:855
  - apps/gameserver-ts/src/core/shared/db/schema.ts:500
---

## Symptôme

`npc_templates.sale_store_id` existe (`schema.ts:500`) et vaut **0 pour tous les
PNJ**. L'importateur l'écrit en dur (`import-starloco-content.ts:855`) et son
en-tête l'assume (`:66-68`) : « an NPC's for-sale item list (dump `ventes`) —
`npc_templates.sale_store_id` is a single id and StarLoco stores the list
inline, so it stays 0 ».

Il n'y a donc ni catalogue en base, ni colonne où le mettre.

## Attendu (1.29)

Action PNJ `N.a` = 1 → `startExchange(0, npcId)` → `ECK0` → le client charge
`NpcShop` (`Exchange.as:357-376`). Le catalogue arrive par `EL`. L'achat est
`EB<templateId>|<quantité>`, la vente `ES<objectId>|<quantité>`, l'un et l'autre
acquittés par `EB`/`ES`.

## Correctif

Trois pièces, dans cet ordre : une table de catalogue et son import depuis
`ventes` ; le premier `ExchangeFlow` qui échange des kamas contre des objets
(donc le premier à consommer `PlayersRepository.spendKamas` dans un échange) ;
la fenêtre `NpcShop` côté client.

C'est aussi le premier type qui a besoin du handler `ExchangeRequestSend` (`ER`),
que la banque n'utilise pas — le client n'envoie jamais `ER5`.

## Reste à faire

Non engagé.
