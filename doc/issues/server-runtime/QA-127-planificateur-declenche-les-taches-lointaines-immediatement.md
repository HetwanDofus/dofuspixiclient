---
id: QA-127
title: Le planificateur déclenche immédiatement toute tâche à plus de 24,8 jours
severity: P1
domain: server-runtime
type: bug
status: fixed
session: 6
opened: 2026-08-30
closed:
fixed_in: QA-108
related: [QA-108]
files:
  - apps/gameserver-ts/src/core/modules/scheduler/scheduler.service.ts:70
---

## Symptôme

Première mise en vente d'un lot à l'hôtel de vente, échéance à 720 heures.
Le journal de `gamed` :

```
[BigStoreFlow] bigstore: listed template=289 x1 for 100 in hall=45 by character=1
[BigStoreFlow] bigstore: listing=4 expired, 1 of template=289 returned to the bank
```

Les deux lignes portent **le même horodatage**. Le lot est retiré du rayon dans
la seconde qui suit sa mise en vente, et sa marchandise part au coffre de
banque. Vu de l'écran, l'objet vendu « disparaît » : il n'est ni dans
l'inventaire, ni dans le stock en magasin.

## Cause

`SchedulerService.arm` passait le délai directement à `setTimeout`, qui stocke
le sien dans un entier signé 32 bits. Au-delà de `2^31-1` ms — 24 jours, 20
heures — la valeur déborde et le rappel s'exécute **immédiatement**, sans
avertissement. 720 heures valent 30 jours ; tout ce qui dépassait 24,8 jours
partait donc à la seconde.

Le défaut était latent depuis la création du planificateur : aucun de ses
appelants n'avait encore programmé une échéance à plus d'un mois.

## Correctif

`arm` réarme par tranches quand le délai dépasse le plafond, et la tâche reste
dans `jobs` pendant toute la chaîne — `cancel`, `has` et la sérialisation du
handoff continuent donc de fonctionner d'une tranche à l'autre.

## Vérification

```bash
cd apps/gameserver-ts && bun test src/core/modules/scheduler/
```

Le cas « a job further out than 24.8 days does not fire immediately » programme
une tâche à 30 jours et vérifie qu'elle n'a pas été déclenchée 20 ms plus tard.
