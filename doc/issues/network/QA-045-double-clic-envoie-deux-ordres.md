---
id: QA-045
title: Le double-clic envoie deux ordres de déplacement identiques
severity: P2
domain: network
type: bug
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-019]
files: []
---

## Symptôme

Un double-clic sur une cellule produit dans la console :

```
cell-click cell=237 … Moving: 265 → 237
cell-click cell=237 … Moving: 265 → 237
```

Deux trames pour un seul geste. Aucun dé-doublonnage ni fenêtre anti-rebond.

## Note — marche et course sont correctes

Vérification faite : le choix se fait sur la longueur du trajet dans
`PlayerMovement` via `shouldUseRun(pathLength, runLimit)`, ce qui est bien le
comportement 1.29. Le double-clic n'a donc **pas** à déclencher la course ; il
ne devrait simplement pas émettre deux ordres.
