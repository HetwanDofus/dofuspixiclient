---
id: QA-122
title: Pas de bouton « Ignorer » sur une proposition d'échange, faute de liste noire
severity: P3
domain: exchange
type: feature
status: open
session: 6
opened: 2026-08-28
closed:
fixed_in:
related: [QA-107]
files:
  - apps/electrobun/src/hud/exchange/TradeRequestDialog.tsx
  - assets/sources/client-code/dofus/aks/Exchange.as:220
---

## Symptôme

La boîte de proposition n'offre que « Oui » et « Non ». Le menu joueur liste
« Ignorer pour la session », grisé.

## Attendu (1.29)

Le client de retail affiche la proposition avec `CAUTION_YESNOIGNORE` : trois
boutons. « Ignorer » ajoute le demandeur à la liste noire de la session, et
`onRequest` répond alors automatiquement par un `leave()` à toute demande
suivante venant de lui (`Exchange.as:220-224`) — sans même afficher la boîte.
La même liste filtre les messages privés et le chat.

## Correctif

Non engagé, et le bouton n'a **pas** été ajouté grisé, contrairement au reste du
menu joueur : un « Ignorer » qui se contenterait de refuser serait un « Non »
déguisé, c'est-à-dire un mensonge sur ce que le bouton fait. La règle « lister
et griser » vaut pour une action dont on sait qu'elle arrivera telle quelle ;
elle ne vaut pas pour une action dont la moitié du sens est ailleurs.

Ce qu'il faut d'abord : une liste noire de session, côté serveur ou côté client,
partagée avec le chat. Le bouton en découle.

## Vérification

Ignorer un joueur, lui demander un échange. *Attendu* : sa proposition suivante
n'affiche aucune boîte et est refusée seule.
