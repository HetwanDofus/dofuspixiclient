---
id: QA-150
title: Un clic sur « Faucher » pendant une récolte est perdu sans un mot
severity: P2
domain: progression
type: bug
status: fixed
session: 7
opened: 2026-09-03
closed:
fixed_in:
related: [QA-123, QA-143]
files:
  - apps/electrobun/src/game/game-client.ts
  - apps/electrobun/src/game/network/handlers/map.handler.ts
  - apps/electrobun/src/game/stores/jobs-store.ts
  - apps/electrobun/src/game/network/handlers/map.handler.spec.ts
---

## Symptôme

En enchaînant les récoltes avec `dev2` (paysan), « Faucher » ne déclenche
parfois rien du tout : le menu se ferme, le personnage ne bouge pas, aucun
message n'apparaît. Recliquer un instant plus tard fonctionne.

Le cas se produit chaque fois que le clic tombe pendant que l'action
précédente tourne encore — ce qui est la façon normale de jouer un métier de
récolte, puisqu'on aligne la ressource suivante en attendant.

## Attendu (décision projet)

QA-143 a tranché : rien n'interrompt une récolte en cours, ni déplacement ni
nouvelle interaction. Enregistrer le clic pour plus tard ne l'interrompt pas
— c'est la seule lecture qui respecte à la fois QA-143 et l'exigence de
QA-123 selon laquelle aucune branche ne reste silencieuse.

## Cause

Deux défauts qui se cumulent, tous deux côté client.

- `GameClient.useInteractive` ouvrait sur `if (isHarvesting()) { return; }` —
  la seule branche muette de toute la boucle de récolte : pas de journal, pas
  de `Im`, rien.
- La fenêtre pendant laquelle ce verrou est levé était plus large que celle
  du serveur. `map.handler` armait `setTimeout(endHarvest, durationMs)` à la
  **réception** de `GA;501`, alors que le serveur arme la sienne à
  l'**émission** : le client restait verrouillé un aller-retour de plus que
  le serveur, et un joueur qui clique dès que la ressource donne clique dans
  ce trou.

## Correctif

- L'action d'élément choisie pendant une récolte est retenue
  (`queuedAfterHarvest`) et rejouée dès que le verrou tombe. Seul le dernier
  clic survit, comme partout ailleurs, et il est abandonné si la carte a
  changé entre-temps.
- `GDF` ferme le verrou : la frame que le serveur envoie quand la ressource
  donne (`InUse`) ou quand il la rend après une interruption (`Ready`) est ce
  qui libère le personnage. Seule `Locked` — la réservation par laquelle
  l'action commence — n'en est pas une. Le compte à rebours reste en
  filet de sécurité si la frame se perd.

## Vérification

```bash
cd apps/electrobun && bun test src/game/network/handlers/map.handler.spec.ts
```

Trois cas : la réservation garde le verrou, la frame de complétion le lève
avant le compte à rebours local, la frame d'une autre cellule ne touche à
rien.

À rejouer à la main : `dev2/dev2`, cliquer « Faucher » sur la ressource
suivante pendant que la précédente tourne — l'action doit partir seule à
l'échéance, sans reclic.
