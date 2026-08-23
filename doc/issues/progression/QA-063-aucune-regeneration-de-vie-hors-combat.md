---
id: QA-063
title: Aucune régénération de vie hors combat
severity: P1
domain: progression
type: gap
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-059]
files: []
---

## Symptôme

Après un combat, les PV perdus ne reviennent jamais. Constaté manette en main.

## Cause

Ce n'est pas cassé : **ce n'est écrit nulle part.** Aucune occurrence de
`regen`, `regeneration` ou équivalent dans tout le serveur. La colonne existe,
la valeur ne bouge pas.

Sans régénération, la boucle de jeu se ferme au bout de deux ou trois combats :
plus rien ne permet de repartir, et c'est aujourd'hui le premier mur rencontré
par un joueur qui enchaîne les combats.

## Attendu (1.29)

La vie remonte passivement au fil du temps réel, plus vite assis que debout, et
le personnage récupère aussi à la connexion en fonction du temps écoulé hors
ligne.

## Correctif — ne pas utiliser de minuterie

Le calculer **paresseusement** : stocker la date du dernier recalcul, et à
chaque lecture des PV (entrée en jeu, entrée en combat, ouverture des
caractéristiques) dériver les points regagnés depuis cette date. Une minuterie
par joueur connecté ne passe pas l'échelle et se perd au redémarrage du core,
alors qu'un horodatage en base survit à tout et coûte zéro tâche de fond.

Le `SchedulerService` reste utile pour l'écriture périodique en base, pas pour
le calcul.

**Le plafond n'est pas une colonne.** `players` porte `life` mais pas de maximum :
celui-ci est dérivé du niveau et de la vitalité par `maxLifePoints()`
(`stats.service.ts:179`), équipement compris. La régénération doit donc borner
avec cette même fonction — sinon un changement d'équipement fera diverger le
plafond de la valeur affichée, et un joueur pourra dépasser son maximum réel.

## Vérification

Voir le runbook du sprint 01, étape « Régénération ».
