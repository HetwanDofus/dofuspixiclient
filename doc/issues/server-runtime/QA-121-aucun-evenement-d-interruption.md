---
id: QA-121
title: Aucun événement de domaine hors session.* — un combat qui démarre n'interrompt rien
severity: P2
domain: server-runtime
type: gap
status: open
session: 6
opened: 2026-08-28
closed:
fixed_in:
related: [QA-112, QA-113, QA-107]
files:
  - apps/gameserver-ts/src/core/shared/gateway-adapter/session-registry.ts:39
  - apps/gameserver-ts/src/core/modules/exchange/trade.flow.ts
---

## Symptôme

`grep -rn 'emit(' src/core` ne trouve que trois canaux, tous portés par
`SessionRegistry` : `session.opened`, `session.closed`, `session.authenticated`.
Il n'existe pas de `fight.started`, pas de `map.changed`, pas de
`player.teleported`.

Conséquence directe pour l'échange : un combat qui démarre pendant un échange
ouvert ne le ferme pas. Une téléportation non plus. Les deux sont **constatés**
au commit — `TradeFlow.stillValid` relit la présence et le registre de combat —
donc rien de faux n'est écrit, mais les deux joueurs gardent une fenêtre ouverte
jusqu'à ce que l'un d'eux valide et découvre que l'échange est mort.

## Attendu (1.29)

Le serveur de retail ferme la fenêtre au moment où la condition tombe, pas à la
validation suivante.

## Cause

Chaque sous-système tient son propre état et n'annonce rien : `FightRegistry`,
`NpcDialogSession` et `ExchangeRegistry` ne se connaissent pas (QA-112) et ne
peuvent donc pas se prévenir. `SessionRegistry` est le seul à émettre, parce
qu'il est le seul dont plusieurs modules avaient besoin d'être avertis.

## Correctif

Non engagé. La forme retenue si on l'ouvre : `EventEmitter2` est déjà là et
`@OnEvent("session.closed")` est déjà l'idiome de nettoyage du dépôt — il s'agit
d'ajouter les canaux manquants au moment où l'état change, pas d'un mécanisme.
À traiter avec QA-112 : le verrou d'occupation unifié et les événements
d'interruption sont les deux moitiés du même manque.

## Vérification

Ouvrir un échange, puis déclencher une agression sur l'un des deux. *Attendu* :
les deux fenêtres se ferment sur un « Echange annulé ». *État actuel* : elles
restent ouvertes et l'échange ne meurt qu'à la validation.
