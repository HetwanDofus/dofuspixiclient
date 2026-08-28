---
id: QA-124
title: Aucun manifeste public ne décrit la topologie navigable du monde
severity: P2
domain: worldmap
type: feature
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-084]
files:
  - apps/electrobun/public/assets/data/map-data.json
  - apps/gameserver-ts/scripts/import-starloco-maps.ts
  - apps/gameserver-ts/scripts/import-starloco-triggers.ts
  - tools/worldmap-exporter/src/Command/ExtractLangDataCommand.php
  - apps/gameserver-ts/scripts/export-navigation-manifest.ts
  - apps/gameserver-ts/scripts/navigation-manifest.ts
  - apps/electrobun/public/assets/data/navigation-manifest.json
  - apps/electrobun/public/assets/data/navigation-manifest.schema.json
---

## Symptôme

L'artefact public `map-data.json` ne contient que la coordonnée et la
super-zone de chaque carte. Il est généré directement depuis les SWF par le
worldmap exporter, indépendamment de l'import réellement utilisé par le
serveur.

La topologie effective n'existe que dans PostgreSQL après `just import-world` :

- `maps` porte l'identité, les coordonnées, la sous-zone et la géométrie ;
- `map_neighbors` porte les sorties de bordure élues ;
- `scripted_cells` porte les téléportations explicites du dump, prioritaires
  sur l'élection géométrique.

Un client public peut donc dessiner la carte du monde, mais il ne peut pas
calculer un itinéraire multi-cartes fidèle au serveur sans reconstruire ou
deviner ces règles.

## Attendu

`dofuspixiclient` possède, génère, versionne et publie un manifeste statique de
navigation utilisable par n'importe quel client joueur. Le manifeste reflète
exactement la projection de monde obtenue après les imports ; il n'expose
aucun état vivant, secret ou administratif.

Il ne s'agit ni d'un endpoint propre à DofBotConsole, ni d'un nouveau projet,
ni d'une lecture publique de PostgreSQL.

## Correctif

### Commande et source

Ajouter une commande explicite, chaînable après `just import-world`, qui lit en
lecture seule `maps`, `map_neighbors` et les téléportations valides de
`scripted_cells`, puis écrit dans les assets publics :

- `navigation-manifest.json` ;
- `navigation-manifest.schema.json`.

L'export doit échouer si un identifiant cible n'existe pas, si une transition
est ambiguë après application des priorités, ou si une donnée obligatoire est
absente. Il ne corrige ni ne complète silencieusement la base.

### Contrat minimal

Le schéma doit contenir :

- un `schemaVersion` entier ;
- une `worldRevision` calculée sur le contenu canonique ;
- les cartes triées par identifiant, avec au minimum `id`, `x`, `y`,
  `subareaId`, `superareaId`, `width`, `height` et le caractère
  intérieur/extérieur lorsqu'il est connu ;
- les transitions de bordure, avec carte source, direction et carte cible ;
- les transitions scriptées, avec carte/cellule source et carte/cellule
  cible ;
- le type et la priorité de chaque transition.

Le format doit permettre de construire un graphe global sans inclure toutes
les cellules : la géométrie détaillée de la carte courante continue d'arriver
par `GameMapData`.

### Déterminisme et publication

À base identique, deux exports doivent être identiques octet pour octet. Les
tableaux et clés sont ordonnés, la sérialisation est canonique et aucun
horodatage variable ne participe au fichier. `worldRevision` est un SHA-256 du
payload canonique hors champ de hash.

Le manifeste est servi avec les autres assets publics du client. Sa génération
est documentée dans le parcours d'import du monde et vérifiée en CI sur une
fixture réduite.

## Hors périmètre

- État disponible/épuisé des ressources, monstres, joueurs ou combats.
- Calcul d'itinéraire et stratégie de déplacement d'un consommateur.
- API spécifique à un logiciel d'automatisation.
- Accès direct ou réplication de la base de production.

## Vérification

- Un test de schéma accepte la fixture publiée et rejette une transition vers
  une carte absente.
- Un test d'export couvre une bordure géométrique et une téléportation
  scriptée, avec leur priorité.
- Deux exports successifs de la même base ont le même SHA-256.
- Toutes les cartes et cibles du manifeste existent dans la projection
  importée.
- Le fichier est récupérable sans session de jeu depuis le chemin public
  documenté.
- Un consommateur de test charge le manifeste, trouve un chemin comprenant au
  moins une bordure et une transition scriptée, puis charge la géométrie
  détaillée uniquement pour la carte courante.
