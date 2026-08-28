---
id: QA-125
title: Les contrats TypeScript du client ne sont pas publiés
severity: P2
domain: network
type: feature
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-124]
files:
  - packages/proto/package.json
  - packages/proto/gen/index.ts
  - packages/grid/package.json
  - packages/grid/src/index.ts
  - proto/account.proto
  - apps/gameserver-ts/src/core/features/auth/login/login.handshake.ts
  - .github/workflows/ci.yml
  - .github/workflows/contracts-publish.yml
  - scripts/verify-contract-packages.ts
  - apps/electrobun/src/game/network/contract-compatibility.ts
---

## Symptôme

Les applications du monorepo consomment `@dofus/proto` et `@dofus/grid` via
les workspaces Bun, mais un client externe ne peut pas installer le même
contrat :

- `@dofus/proto` est `private`, exporte directement les sources générées
  TypeScript et n'a aucun artefact de publication ;
- `@dofus/grid` exporte lui aussi `src/index.ts` sans build de distribution ;
- aucun workflow ne construit, empaquette, teste puis publie ces paquets ;
- le handshake n'annonce pas les versions exactes du protocole, de la grille
  et du manifeste de navigation attendues par le serveur.

La seule solution actuelle serait une dépendance `file:` vers un checkout
voisin ou une copie de sources, ce qui rendrait les clients impossibles à
reproduire et à rendre compatibles de manière explicite.

## Attendu

`dofuspixiclient` reste propriétaire des contrats partagés et publie des
versions immuables, installables sans checkout du jeu :

- `@dofus/proto` pour les enveloppes et messages protobuf ;
- `@dofus/grid` pour la géométrie et le pathfinding communs.

Un client épingle des versions exactes. Dès le handshake, il peut comparer les
versions qu'il embarque à celles annoncées par le serveur et refuser toute
action en cas d'incompatibilité. Le serveur et le client officiel utilisent
les mêmes artefacts publiables que les consommateurs externes.

## Correctif

### Construire de vrais paquets

Pour chacun des deux paquets :

- produire de l'ESM JavaScript et des déclarations TypeScript dans `dist/` ;
- définir des `exports` complets et stables vers `dist/`, y compris les
  sous-chemins protobuf nécessaires ;
- ne publier que les fichiers requis à l'exécution et les déclarations ;
- conserver les source maps et licences utiles ;
- déclarer toutes les dépendances d'exécution ;
- exposer une constante de version issue du `package.json`.

`@dofus/proto` doit être régénéré depuis `proto/*.proto` avant empaquetage. La
CI échoue si cette génération modifie le dépôt ou si un import généré pointe
vers un fichier absent.

### Vérifier l'installation hors monorepo

La CI crée les tarballs avec `npm pack`, initialise un projet consommateur
temporaire sans workspace, installe les tarballs puis vérifie sous Bun et Node :

- encodage d'un `ClientMessage` et décodage d'un `DofusMessage` ;
- import par le barrel et par un sous-chemin documenté ;
- création d'une grille et calcul d'un chemin minimal ;
- compilation TypeScript du consommateur sans alias du monorepo.

Le choix du registre et le déclencheur de publication restent configurables,
mais la fiche n'est pas terminée si seule une dépendance workspace fonctionne.
Une version déjà publiée ne peut jamais être écrasée.

### Annoncer le contrat du serveur

Étendre le premier message de handshake avec :

- la version exacte de `@dofus/proto` ;
- la version exacte de `@dofus/grid` ;
- le `schemaVersion` et la `worldRevision` du manifeste QA-124.

Ces valeurs viennent des artefacts construits et du manifeste publié, pas de
constantes dupliquées à la main. Le client officiel les expose dans ses logs et
continue de fonctionner. Un consommateur externe peut effectuer sa
vérification avant d'envoyer ses identifiants.

Le paquet partagé reste limité aux contrats de transport et aux primitives de
grille. Les machines d'état, réducteurs headless, règles métier
d'automatisation, sockets, secrets et accès base n'y entrent pas. Si
l'authentification nécessite plus tard un helper commun, il fera l'objet d'un
petit paquet séparé et d'une fiche dédiée.

## Versionnement

- Ajout protobuf rétrocompatible : version mineure.
- Suppression, changement de sens ou renumérotation d'un champ : version
  majeure.
- Correction sans changement de contrat : version patch.
- Changement incompatible de la grille ou de son résultat documenté : version
  majeure.

Chaque release publie ses notes et lie le commit source. Les consommateurs
n'utilisent ni `latest` flottant, ni plage permissive pour ces contrats.

## Vérification

- `bun run build` produit deux répertoires `dist/` sans source TypeScript
  requise à l'exécution.
- Les tests `npm pack` hors workspace passent sous les versions Node et Bun
  supportées.
- Une publication de test installe les deux paquets par version exacte.
- Le handshake annonce les versions provenant réellement des paquets et la
  révision du manifeste servi.
- Un test de compatibilité accepte l'ensemble exact et refuse une version
  majeure de protocole, de grille ou de schéma différente.
- Aucun test ni application externe ne référence un chemin du checkout
  `dofuspixiclient`.
