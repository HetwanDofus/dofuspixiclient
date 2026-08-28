---
id: QA-120
title: Aucun contrôle de surcharge : un échange peut mettre le receveur en surpoids
severity: P2
domain: exchange
type: gap
status: open
session: 6
opened: 2026-08-28
closed:
fixed_in:
related: [QA-107, QA-086]
files:
  - apps/gameserver-ts/src/core/modules/exchange/trade.flow.ts
  - apps/gameserver-ts/src/core/modules/stats/stats.service.ts
  - assets/sources/client-code/dofus/aks/Exchange.as:245
---

## Symptôme

`TradeFlow.commit` transfère tout ce qui est sur la table sans regarder les pods
du receveur. Deux joueurs peuvent donc s'échanger 500 pods de minerai contre un
anneau et se retrouver l'un des deux très au-delà de sa capacité.

Le même trou existe sur le rangement : rien ne vérifie qu'un retrait de banque
tient dans l'inventaire.

## Attendu (1.29)

Le client de retail refuse la demande avec `ERo` → `ERROR_70`, « Action annulée
pour cause de surcharge... » (`Exchange.as:245`, `lang.json`). Le contrôle est
donc canoniquement à la **demande**, ce qui ne suffit pas ici : au moment de
`ER` l'offre n'existe pas encore. Il faut le refaire au commit.

## Correctif

Non engagé. Ce qu'il demande :

- calculer les pods d'après-échange **des deux côtés** — poids sortant retiré,
  poids entrant ajouté — avant d'ouvrir la transaction ;
- réutiliser `currentPods` / `maxPods`, aujourd'hui privés dans
  `StatsService.sendWeight` : ils devront sortir dans un petit service de poids
  que l'échange et le rangement appellent tous les deux ;
- annuler l'échange par un `EV` non abouti, avec une ligne de chat qui dit
  laquelle des deux capacités a lâché — sans quoi les deux joueurs voient
  « Echange annulé » sans savoir pourquoi.

Laissé dehors de la passe QA-107 volontairement : c'est un calcul à part entière
et non une ligne de garde, et le trou est identique sur un flux déjà livré (la
banque), donc le correctif doit être commun aux deux.

## Vérification

Deux personnages, l'un chargé à 95 % de ses pods. Lui proposer 200 pods de
minerai et valider des deux côtés. *Attendu* : refus explicite. *État actuel* :
l'échange passe et le receveur est en surpoids.
