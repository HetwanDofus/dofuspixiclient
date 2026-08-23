---
id: QA-064
title: Aucune limitation de débit sur les messages entrants
severity: P1
domain: server-runtime
type: gap
status: confirmed
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-065, QA-067]
files:
  - apps/gameserver-ts/src/gateway/
---

## Symptôme

Aucune occurrence de limitation de débit, d'étranglement ou d'anti-flood dans
le gateway ni dans les cores. Un client peut émettre autant de trames qu'il
peut en produire, sur n'importe quel message, **y compris avant de s'être
authentifié**.

## Portée

Trois conséquences, par ordre de gravité :

- **Déni de service trivial.** Une seule socket qui boucle sur `GameGetMapData`
  occupe le core, qui est mono-processus et partagé par tous les joueurs.
- **Amplification.** Les messages qui diffusent (déplacement, chat) coûtent au
  serveur *fois le nombre de joueurs sur la map*. Un attaquant sur une map
  peuplée multiplie son propre débit.
- **Rien ne borne le buffer d'authentification**, ce qui rend le flood possible
  sans compte valide.

C'est le trou de sécurité le plus large du projet aujourd'hui : le lancer de
sorts, lui, est correctement validé (tour, PA, portée, ligne de vue, cooldown).

## Correctif

Un compteur à jetons **par session, au gateway** — c'est le seul étage qui voit
toutes les trames et qui peut refuser sans réveiller le core. Un plafond global
par message, plus un plafond serré sur les messages coûteux (données de map,
chat). Dépassement : fermeture avec un code applicatif dédié, sur le modèle des
codes 4001 / 4002 existants.

## Vérification

Voir le runbook du sprint 01, étape « Limitation de débit ».
