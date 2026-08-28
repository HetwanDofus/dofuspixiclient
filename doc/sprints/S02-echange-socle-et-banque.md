# Sprint 02 — L'échange : le socle, prouvé par la banque

**Objectif** — poser le sous-système d'échange que les dix-huit types
réutiliseront, et le faire porter par le flux le plus simple : la banque.

**Pourquoi maintenant** — S01 a ouvert le robinet des objets (QA-060, première
insertion dans `player_items`). Aujourd'hui un objet ne peut qu'apparaître : il
n'existe aucun moyen de le déplacer ailleurs que dans les mains de son
propriétaire. Tout le commerce du jeu — banque, coffre, boutique, marchand,
hôtel de vente, percepteur, monture — attend le même socle, et chaque semaine
passée à empiler des fonctionnalités par-dessus un modèle d'objet à quatre
tables rend sa reprise plus chère.

**Pourquoi la banque d'abord** — c'est le seul flux à **un joueur, un commit,
pas de rollback à deux côtés**. Elle exerce tout le socle — session, verrou,
déplacement atomique, journal d'audit, fenêtre — sans le cas dur du commerce
entre joueurs. Si le socle est bon, la banque est petite. Si la banque est
grosse, le socle est mauvais : c'est le signal que ce sprint est fait pour
donner.

**Fini quand** — le runbook en fin de document passe intégralement.

---

## Hors périmètre — explicitement

- **Tous les autres types d'échange** : QA-105 (coffre), QA-106 (boutique PNJ),
  QA-107 (joueur-joueur), QA-108 (hôtel de vente), QA-109 (marchand),
  QA-110 (percepteur), QA-111 (monture). Ils ont chacun leur fiche et attendent
  ce sprint ; en faire entrer un seul ferait échouer les deux.
- **`big_store_listings`** n'est pas touchée. Sa refonte en lots 1/10/100 est
  une décision de schéma à part entière — QA-108.
- **Le skin de la fenêtre.** L'inventaire est déjà skinné 1.29 (QA-078, `fixed`) :
  on réutilise ses assets et ses composants, on ne dessine rien de neuf.
- **La limitation de débit** (QA-064) et **le contrôle de distance** (QA-114).
  La sérialisation par session rend la banque sûre sans eux. Ils restent
  nécessaires pour le reste du jeu, ils ne le sont pas pour clore celui-ci.
- **La migration du combat et du dialogue derrière le verrou unifié** (QA-112),
  et **la survie des dialogues au redémarrage** (QA-113). Le verrou et la partie
  de transfert d'état sont écrits ici ; les faire adopter par les sous-systèmes
  existants est le sprint d'après.

---

## Lot A — Le modèle (prérequis de tout)

En premier parce que rien ne peut être écrit correctement au-dessus d'un objet
qui change d'identité à chaque déplacement.

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| A1 | [QA-101](../issues/exchange/QA-101-modele-d-objet-polymorphe.md) | Une table `items` à propriétaire polymorphe, ses contraintes, son journal d'audit | 2–3 jours |
| A2 | [QA-115](../issues/exchange/QA-115-aucun-test-anti-dupe.md) | Les cinq cas de concurrence, écrits **avec** A1 | 1 jour |

**A2 n'est pas après A1, il est dedans.** Un déplacement atomique dont personne
n'a prouvé l'atomicité n'est qu'une intention. Le harnais d'intégration sait
déjà ouvrir deux transactions concurrentes — `exchange-ticket.repository.int.spec.ts`
le fait — donc il n'y a pas d'outillage à construire, seulement des cas à écrire.

> **Le point d'attention du lot.** Le rayon d'explosion de A1 est aujourd'hui
> d'un seul fichier — `inventory.repository.ts`, huit requêtes — plus le seed de
> développement. Il croîtra avec chaque contenant ajouté. C'est la raison, et la
> seule, pour laquelle ce lot passe avant la fonctionnalité que l'on veut voir.

## Lot B — Le protocole

Petit, mécanique, et à faire avant d'écrire une ligne de handler pour ne pas
avoir à la réécrire.

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| B1 | [QA-103](../issues/exchange/QA-103-exchangetype-diverge-du-client.md) | `ExchangeType` réaligné sur le client décompilé du dépôt | ½ jour |
| B2 | [QA-104](../issues/exchange/QA-104-formes-de-messages-d-echange-inadaptees.md) | `ExchangeList` et `ExchangeItemMovement` portent un `ItemData` | ½ jour |

**B1 avant tout le reste du lot C.** L'énumération se trompe de onze valeurs sur
dix-neuf, et **la banque est le type 5, pas le 6**. Écrire le `StorageFlow`
contre la mauvaise constante, c'est le réécrire.

## Lot C — Le noyau et la banque

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| C1 | [QA-102](../issues/exchange/QA-102-noyau-de-session-d-echange.md) | Session, verrou d'occupation, sérialisation par session, partie de transfert d'état | 2–3 jours |
| C2 | [QA-086](../issues/world-content/QA-086-coffre-et-banque-sans-transfert-d-objets.md) | Le `StorageFlow`, la tranche serveur, la fenêtre client | 3–4 jours |

**C1 avant C2, et C1 est le vrai livrable du sprint.** C2 est ce qu'on regarde à
l'écran ; C1 est ce qui rend les sept fiches suivantes petites.

**La sérialisation par session n'est pas une précaution de confort.**
`GatewayFrameService.onFrame` appelle `WsRouter.dispatch` sans `await` : deux
trames du même client s'entrelacent réellement, et rien au gateway ne les
limite ni ne les dédoublonne. C'est ce qui fait du double-clic un cas de test et
non une hypothèse.

**Ce que C2 ne doit pas faire** — inventer un contrôle de distance, un
plafond de pods côté banque, ou une phase de validation. Le client de retail
n'attend aucun des trois pour le type 5, et chacun est une fiche à part.

---

## Runbook

À exécuter à la main, dans l'ordre, par quelqu'un qui n'a pas écrit le code.

### Préparation

```bash
git lfs pull && bun install
just wasm
just db && SPAWN_MAP_ID=7365 just db-seed
just dev
```

Se connecter (`dev` / `dev`), choisir le personnage, vérifier que l'inventaire
(`i`) contient bien des objets. Sans objets, rien de ce qui suit ne se teste.

---

### 1 · Le modèle tient — A1, A2

> Couvre QA-101 et QA-115.

```bash
cd apps/gameserver-ts && bun run test:integration
```

**Attendu** — les cinq cas de QA-115 passent, dont « deux dépôts simultanés
d'objets identiques ne produisent qu'une ligne ».

**Échec si** — un cas de concurrence passe *parfois*. Un test anti-dupe
intermittent est un test qui a trouvé le bug, pas un test instable ; le relancer
jusqu'à ce qu'il passe est la seule mauvaise réponse possible.

**La vérification qui compte autant** — la non-régression de l'inventaire, à la
main : équiper une arme, la déséquiper, boire une potion, glisser un objet dans
la barre de raccourcis, gagner un combat et récupérer le butin. A1 réécrit le
dépôt d'objets sous tout cela.

---

### 2 · Ouvrir la banque — C2

> Couvre QA-086.

**Gestes** — aller à la banque d'Astrub, clic droit sur le coffre, « Ouvrir ».

**Attendu** — une fenêtre s'ouvre : l'inventaire du personnage à gauche, le
contenu de la banque à droite, un solde de kamas de chaque côté.

**Échec si** — rien ne s'ouvre. C'est l'état actuel du dépôt : le serveur répond
déjà `sI` et personne ne l'écoute.

**Le cas à ne pas oublier** — ouvrir l'inventaire (`i`) **avant** d'ouvrir la
banque. L'inventaire ne doit pas se fermer. Les panneaux du HUD sont
mutuellement exclusifs par construction ; la banque doit sortir de cette
rotation, comme le fait déjà la fenêtre de dialogue PNJ.

---

### 3 · Déplacer des objets — C2

**Gestes**

1. Déposer une pile entière.
2. Déposer 5 objets d'une pile de 10.
3. Retirer les 5.
4. Fermer la fenêtre, la rouvrir.

**Attendu** — les deux grilles se mettent à jour sans rechargement ; les pods du
personnage baissent au dépôt et remontent au retrait ; après réouverture, le
contenu de la banque est celui qu'on a laissé.

**Échec si** — la grille de banque reste vide alors que la base a bien la ligne.
C'est la signature du contrat d'ouverture : le client attend `EC` **puis** la
liste complète, et tout mouvement envoyé avant la liste est perdu.

---

### 4 · Le double-clic — C1

> Le cas qui justifie la sérialisation par session.

**Gestes** — double-cliquer aussi vite que possible sur le même objet pour le
déposer. Recommencer cinq fois avec des objets différents.

**Attendu** — un seul dépôt par objet. La quantité totale possédée, banque plus
inventaire, ne change jamais.

**Échec si** — l'objet est déposé deux fois, ou disparaît. Rien au gateway ne
dédoublonne les trames (QA-045, QA-064) et le routeur ne les sérialise pas : les
deux requêtes arrivent vraiment et s'entrelacent vraiment.

**La vérification en base**, après la manipulation :

```bash
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus -tAc \
  "select owner_kind, owner_id, template_id, quantity from items order by 1,3;"
```

Aucune ligne avec `quantity <= 0`, aucun doublon de
`(owner_kind, owner_id, template_id, effects_hash)` en position `-1`.

---

### 5 · Les kamas — C2

**Gestes** — déposer des kamas, en retirer, puis essayer d'en retirer plus que
la banque n'en contient.

**Attendu** — les deux soldes bougent immédiatement, des deux côtés. Le
troisième geste est refusé sans effet.

**Échec si** — un solde affiché reste périmé jusqu'au prochain changement de
carte. Rien dans la couche échange ne rafraîchit les kamas du joueur ; c'est la
trame de statistiques qui le fait, et elle doit être renvoyée après chaque
mouvement.

**Le cas qui compte le plus** — aucun des deux soldes ne doit pouvoir devenir
négatif, y compris sous double-clic.

---

### 6 · La banque est partagée sur le compte — C2

> C'est la décision de conception de ce sprint, elle se recette explicitement.

**Préparation** — un second personnage sur le même compte.

```bash
cd dofus-bot-manager && bun run server
bun run cli spawn -u dev -p dev -c <second personnage> --json
```

**Gestes** — déposer un objet avec le premier, ouvrir la banque avec le second.

**Attendu** — l'objet est là.

**Échec si** — chaque personnage voit un coffre différent. C'est le contraire de
ce qui a été décidé, et cela signifie que le propriétaire du contenant est le
personnage et non le compte.

---

### 7 · Survie au redémarrage — C1

**Gestes** — banque ouverte, avec des objets des deux côtés :

```bash
docker restart dofuspixiclient-gamed-1
```

**Attendu** — **de deux choses l'une, et les deux sont acceptables** : soit la
session survit et la fenêtre reste utilisable, soit le serveur la ferme
proprement et la fenêtre disparaît.

**Échec si** — la fenêtre reste ouverte et ne répond plus. C'est exactement ce
que font aujourd'hui les dialogues PNJ (QA-113), et c'est le comportement que ce
sprint s'engage à ne pas reproduire.

**La variante qui sert tous les jours** — refaire l'essai sous `just gamed` en
mode watch, en modifiant un fichier serveur. C'est le bénéfice quotidien de la
partie de transfert d'état.

---

### 8 · Déconnexion pendant l'échange — C1

**Gestes** — banque ouverte, fermer brutalement l'onglet (ou
`bun run cli kill --id <bot_id> --json`), puis se reconnecter.

**Attendu** — la session d'échange est libérée. Rouvrir la banque fonctionne du
premier coup ; le personnage n'est pas considéré comme occupé.

**Échec si** — la seconde ouverture est refusée. Le verrou d'occupation doit
écouter la fermeture de session, comme le fait déjà le dialogue PNJ.

---

### 9 · Non-régression avant clôture

1. Connexion, sélection de serveur, sélection de personnage.
2. Cinq changements de map enchaînés, aucune erreur console.
3. Un combat complet, gagné, avec butin **et** XP.
4. Équiper, déséquiper, utiliser une potion, poser un raccourci.
5. Un zaap emprunté, kamas débités.
6. Déconnexion propre, reconnexion : inventaire et banque intacts.

Puis :

```bash
cd apps/gameserver-ts && bun test src/ && bun run test:integration && bun run typecheck && bun run lint
cd ../electrobun     && bun test && bun run check-types && bun run lint
cd ../..             && just issues-check
```

**Le sprint est clos** quand cette liste passe et que les huit étapes
précédentes sont vertes.

## À faire à la clôture

Passer QA-086, QA-101, QA-102, QA-103, QA-104 et QA-115 en `fixed`, renseigner
leur `fixed_in`, puis `just issues`. Elles ne passent `closed` qu'après avoir été
rejouées manette en main — c'est ce que ce runbook permet de franchir.

Le sprint suivant se choisit dans ce qui reste : QA-105 (coffre de maison) est
le moins cher, QA-107 (joueur-joueur) le plus structurant, QA-108 (hôtel de
vente) le plus visible puisque les cinquante-cinq vendeurs sont déjà en jeu.
