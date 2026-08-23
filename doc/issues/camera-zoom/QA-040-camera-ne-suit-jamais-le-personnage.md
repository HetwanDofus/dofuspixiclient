---
id: QA-040
title: La caméra ne suit jamais le personnage
severity: P2
domain: camera-zoom
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-039]
files: []
---

## Symptôme

`mapContainer.x/y` reste à `0,0` en toutes circonstances — relevé avant et
après un déplacement.

Aux zooms élevés le personnage sort du cadre et rien ne le ramène ; après un
dézoom la vue reste sur le coin de map où l'on se trouvait. Aucun bouton ni
raccourci ne recentre la vue.
