---
id: QA-118
title: « Consulter son coffre personnel » est grisé — une réponse ne pouvait porter qu'une navigation
severity: P1
domain: exchange
type: gap
status: fixed
session: 6
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-097, QA-119]
files:
  - apps/gameserver-ts/src/core/modules/npcs/npc-dialog.service.ts
  - apps/gameserver-ts/src/core/features/game/npc-dialog/npc-dialog.handler.ts
---

## Symptôme

Relevé manette en main : chez le banquier, la réponse « Consulter son coffre
personnel » est listée mais **grisée**. Le coffre ne s'ouvre que par l'objet
interactif, jamais par le dialogue.

## Cause

`classify` (`npc-dialog.service.ts`) ne suivait une réponse que lorsque la
navigation était *tout* ce qu'elle faisait : `actions.length > 1` valait
`blocked`. La règle était juste — une réponse qui branche *et* remet un objet
sauterait l'objet en silence — mais trop large.

La réponse 259 porte deux lignes :

```
259 | type  1 | args 'DV' | nom 'Consulter son coffre personnel'
259 | type -1 | args ''   | nom 'Consulter son coffre personnel'
```

Le type **-1** n'apparaît **qu'une seule fois dans toute la base** — cette
ligne — et la colonne `nom` du dump le nomme. C'est « ouvrir le coffre ». La
réponse était donc grisée parce qu'elle porte un effet *implémentable* à côté
de sa navigation, pas parce que l'effet était inconnu.

## Correctif

`classify` raisonne désormais en « une navigation plus un ensemble d'effets » :
elle partitionne les lignes, grise dès qu'un effet n'est pas implémenté, et
laisse passer ceux qui le sont. La sévérité est conservée mot pour mot — un
effet inconnu grise toujours, deux navigations aussi — seule la liste des
effets qualifiés change, et elle contient aujourd'hui un seul membre.

Nouvelle issue `{ kind: "open-bank" }`, traitée par `NpcDialogHandler.openBank`.
La conversation est fermée **avant** l'ouverture du coffre : `onLeave` du client
1.29 décharge toutes les fenêtres d'échange, donc un `DV` envoyé après `EC`
refermerait la banque à l'instant où elle s'ouvre.

Le chemin passe par le même `ExchangeService.openStorage` que l'objet
interactif — verrou d'occupation, paire `EC`+`EL` et session compatible avec le
transfert d'état viennent avec, au lieu d'être réécrits.

## Vérification

Quatre cas sur `classify` (la réponse du banquier dans les deux ordres, un effet
implémenté à côté d'un inconnu qui reste grisé, deux navigations refusées) et un
cas sur le handler qui vérifie la séquence `dialogLeave` puis l'ouverture sur
`OwnerKind.Bank`. `bun test src/` — 446 verts.
