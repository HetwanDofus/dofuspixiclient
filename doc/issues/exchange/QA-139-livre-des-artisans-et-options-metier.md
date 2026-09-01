---
id: QA-139
title: Pas de livre des artisans ni d'options de métier
severity: P3
domain: exchange
type: feature
status: fixed
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-131, QA-135, QA-138]
files:
  - proto/exchange.proto
  - proto/misc.proto
  - proto/client_messages.proto
---

## Symptôme

`EXCHANGE_CRAFTER_LIST = 14`, `ExchangeCrafterList` (`EJ`),
`ExchangeGetCrafterRequest` (`EJF`), `JobOptions` (`JO`, serveur 2204) et
`JobChangeOptionsRequest` (client 1500) sont tous typés et tous sans producteur
ni consommateur. Les 12 modèles d'objets interactifs de type `CraftsmenList`
sont importés et inertes.

## Attendu (1.29)

Une rune de métier activée à chaque connexion inscrit l'artisan au livre. Les
options sont quatre bits, tels que `dofus/datacenter/JobOptions.as` les lit :
payant, gratuit si échec, fournit les ressources, plus un nombre minimum
d'ingrédients. Le mode public se désactive au logout et au retrait de l'outil.

## Cause

Rien n'est engagé.

## Correctif

Migration 0058 : `player_jobs` gagne `options`, `min_slots` et `listed`.
`JobChangeOptionsRequest` écrit les trois, `JO` les renvoie, et le type 14
sert la liste (`EJF` → `EJ`).

**Décision assumée : envoyer ses options *est* l'inscription au livre.** Le
frame client ne porte aucun drapeau « inscris-moi », et le 1.29 redemande les
options à chaque connexion — c'est la seule lecture sous laquelle « activer à
chaque connexion » décrit le protocole plutôt qu'une étape en plus. Inventer un
bit « public » dans un masque dont `JobOptions.as` documente les trois autres
aurait été une extension du protocole pour rien.

`listed` retombe sur deux chemins : la fermeture de session
(`@OnEvent("session.closed")`) et le retrait de l'outil du slot arme, où
`unlistExcept` ne garde que le métier de l'outil porté.

Deux pièges du fil, tous deux couverts par un test :

- `JO` porte un **index dans la liste des métiers du client**, pas un
  identifiant de métier — `aks/Job.as:onOptions` écrit `Player.Jobs[index]` ;
- `CrafterSummary.min_level` porte le nombre minimum d'**ingrédients**, pas un
  niveau de personnage.

## Vérification

Activer le mode public, se déconnecter, se reconnecter : le mode est retombé.
Retirer l'outil : le mode retombe aussi. Un second joueur voit l'artisan dans la
liste de son métier tant que le mode est actif, et plus après.
