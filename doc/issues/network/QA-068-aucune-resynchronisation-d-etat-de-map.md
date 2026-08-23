---
id: QA-068
title: Aucune resynchronisation d'état de map — une trame perdue est définitive
severity: P1
domain: network
type: gap
status: confirmed
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-019, QA-046]
files: []
---

## Symptôme

Toute la cohérence entre joueurs repose sur la diffusion incrémentale : arrivée,
départ, mouvement. **Il n'existe aucun message « voici l'état complet de la map,
réaligne-toi ».**

Un client qui rate une trame — onglet passé en arrière-plan, micro-coupure,
trame perdue pendant un redémarrage du core — reste durablement faux, et rien
ne le corrige jamais. Symptômes typiques : un joueur qu'on voit encore alors
qu'il est parti, ou immobile sur une case qu'il a quittée.

## Portée

C'est le filet de sécurité sur lequel repose la cohérence de tout MMO. Son
absence ne se voit pas à un joueur ; elle devient systématique dès qu'on teste
à plusieurs, et elle rend tout autre bug de synchronisation impossible à
diagnostiquer — on ne sait jamais si l'on regarde le bug ou une divergence
accumulée.

QA-046 a réglé le cas franc (session morte → on ferme et on le dit). Le cas
insidieux — session vivante, état divergent — reste entier.

## Correctif

Un message d'état complet de map, réutilisant la charge déjà construite par
`enter-game`, émis sur trois déclencheurs : demande explicite du client, retour
de visibilité de l'onglet, et reprise après une coupure du lien avec le core.

## Vérification

Voir le runbook du sprint 01, étape « Deux clients ».
