---
id: QA-135
title: Aucun atelier — l'échange de type 3 est refusé
severity: P1
domain: exchange
type: feature
status: fixed
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-102, QA-086, QA-123, QA-136, QA-137]
files:
  - apps/gameserver-ts/src/core/modules/exchange/exchange.service.ts
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.service.ts
  - proto/exchange.proto
---

## Symptôme

`EXCHANGE_CRAFT = 3` n'a aucun flux : une demande d'ouverture tombe dans
`refuseRequest("unsupported-type")`. Cliquer un établi, un moule, une meule ou
un chaudron n'ouvre rien — la compétence de l'atelier arrive au serveur et
`InteractiveObjectsService.use` la journalise comme non implémentée.

Les **33 modèles d'objets interactifs de type 2 (atelier)** sont pourtant
importés dans `interactive_objects_templates`, avec leur `duration_ms`, et le
protocole complet est typé et sans producteur : `EC`, `Ec`, `EA`, `Ea`, `Er`,
`Ep`, `EMR`, `EMr`.

## Attendu (1.29)

Debout sur ou à côté de l'atelier de son métier, outil équipé, le joueur ouvre
une fenêtre à deux grilles : son sac, et les cases de la recette. Il fabrique à
l'unité ou en série. Les ingrédients sont consommés **à chaque tentative**,
réussite ou échec.

## Cause

Le socle d'échange (QA-102) a été prouvé par la banque et étendu au commerce
entre joueurs et à l'hôtel de vente ; l'artisanat attendait un référentiel de
métiers qui n'existait pas (QA-129).

## Correctif

`modules/exchange/craft.flow.ts`, à côté de `storage.flow.ts` et
`trade.flow.ts`, ouvert par `InteractiveObjectsService` quand le modèle est de
type `Workbench` et la compétence de `kind = 2`. Il réutilise tel quel la
session, le verrou d'occupation, la sérialisation par session et le transfert
d'état au redémarrage.

Les règles de cases, de taux et d'expérience sont QA-136 ; la fenêtre est
QA-137.

## Vérification

Un test de flux couvre : ouverture hors atelier refusée, sans outil refusée,
métier absent refusé, ingrédients insuffisants refusés, et la consommation des
ingrédients sur un échec. Un test de concurrence prouve qu'un double-clic ne
fabrique jamais deux fois avec les mêmes ingrédients.
