---
id: QA-119
title: Le banquier annonce un coût de consultation en affichant le littéral [bankCost]
severity: P2
domain: world-content
type: gap
status: open
session: 6
opened: 2026-08-28
closed:
fixed_in:
related: [QA-118, QA-086]
files:
  - apps/gameserver-ts/src/core/modules/npcs/npc-dialog.service.ts
  - apps/gameserver-ts/scripts/import-starloco-content.ts
---

## Symptôme

La question 318 du banquier se lit en jeu :

> « […] chaque consultation de votre compte vous coûtera **[bankCost]** Kamas. »

`npc_dialog_questions.parameters` vaut littéralement `["[bankCost]"]`, et le
client substitue le `#1` du texte par ce qu'on lui envoie — donc par le
gabarit lui-même.

## Attendu (1.29)

Le serveur remplace le gabarit par le coût réel avant d'émettre la question, et
**débite** ce montant à l'ouverture du coffre. Le texte de la question 2349 du
dump confirme que la consultation est payante.

## Cause

`parameters` est stocké tel quel par l'importateur, et rien côté serveur ne
substitue de gabarit. `QA-118` a câblé l'ouverture du coffre sans toucher au
coût : ouvrir gratuitement un coffre dont le PNJ annonce un prix est une
divergence, mais inventer le prix en est une autre.

## Décision à prendre

Deux choses à trancher ensemble, parce que l'une sans l'autre est incohérente :

1. **Le montant.** Rien dans le dépôt ne le donne — ni le dump, ni le client
   décompilé. C'est un réglage de jeu.
2. **Le mécanisme.** Un gabarit `[bankCost]` résolu au moment d'émettre la
   question, plus un débit dans `openBank` via `PlayersRepository.spendKamas`
   (le prédicat dans l'`UPDATE`, comme le zaap), avec un refus d'ouverture si
   le solde ne suffit pas.

En attendant, le coffre s'ouvre gratuitement et le texte affiche le gabarit.
