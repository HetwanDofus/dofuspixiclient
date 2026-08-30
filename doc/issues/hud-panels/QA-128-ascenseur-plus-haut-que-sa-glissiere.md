---
id: QA-128
title: L'ascenseur dépasse sa glissière quand la liste est plus courte que sa fenêtre
severity: P2
domain: hud-panels
type: bug
status: fixed
session: 6
opened: 2026-08-30
closed:
fixed_in: QA-108
related: [QA-108]
files:
  - apps/electrobun/src/hud/components/Scrollbar.tsx:48
---

## Symptôme

Fenêtre d'achat de l'hôtel de vente, catégorie ne contenant qu'un seul objet :
le panneau se dote d'une barre de défilement verticale alors que rien ne
dépasse à l'œil. Relevé dans la console sur `.dofus-panel__content` :

```
clientHeight 631 · scrollHeight 4394
→ un BUTTON de 4277 px de haut
```

Le bouton en question est le curseur de l'ascenseur de la liste.

## Cause

`Scrollbar` calculait `thumbHeight = max(minimum, (viewportHeight /
contentHeight) * trackHeight)` sans plafond. Une liste plus courte que sa
propre fenêtre donne un rapport supérieur à 1 : une ligne de 20 unités dans
une fenêtre de 12 lignes donne un facteur 12, et un curseur douze fois plus
haut que sa glissière.

Latent jusqu'ici parce que tous les appelants existants — grille d'inventaire,
grimoire de sorts — remplissent leur contenu jusqu'à la hauteur visible et ne
passaient donc jamais un rapport supérieur à 1.

## Correctif

Le curseur est borné par la glissière, et `contentHeight` par 1 pour écarter
la division par zéro d'une liste vide.

## Vérification

Ouvrir l'hôtel de vente d'Astrub (map 7397) en mode achat sur une catégorie
qui ne contient qu'un objet : aucune barre de défilement ne doit apparaître
sur le panneau lui-même, et le curseur de la liste doit tenir dans sa
glissière.
