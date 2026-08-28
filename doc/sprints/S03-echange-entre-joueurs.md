# S03 — L'échange entre joueurs

**Objectif** : livrer le type 1, le seul flux du protocole d'échange qui ait
deux sessions, deux offres, deux validations et un vrai rollback — et vérifier
par là que la promesse du socle S02 tient : *un type de plus est un
`ExchangeFlow` de plus, jamais un sous-système de plus.*

Fiches ordonnées : **QA-107** (le flux), puis **QA-120**, **QA-121**, **QA-122**
pour ce que cette passe laisse dehors et pourquoi.

## L'ordre, et pourquoi

| Lot | Contenu | Pourquoi ici |
|---|---|---|
| 0 | Protocole : `ExchangeRequest`, `ExchangeReady`, `ExchangeLeave` | Trois formes que rien ne consommait encore. Le coût est nul maintenant et croissant à chaque consommateur. |
| 1 | `ExchangeSession.phase` / `lockKey`, `TradeRegistryService` | Le socle S02 est unilatéral. Tant qu'une session ne peut pas partager sa file avec une autre, il n'y a pas d'échange à deux à écrire. |
| 2 | `TradeFlow` | Le flux lui-même. Ne peut rien avant le lot 1. |
| 3 | Handlers `ER` / `EA` / `EK`, blocage du déplacement | La tranche. Après le flux, parce qu'elle n'en est que la porte. |
| 4 | Client : menu joueur, `trade-store`, les deux fenêtres | Après le serveur, pour que chaque écran ait quelque chose à afficher pendant qu'on l'écrit. |
| 5 | Tests unitaires, intégration, client | En dernier pour l'écriture, mais le cas « refus à mi-commit » est celui qui décide si le lot 2 est fini. |
| 6 | Fiches et sprint | — |

Le lot 1 est la seule décision structurante de la passe. QA-107 annonçait
« deux sessions à verrouiller ensemble sans interblocage » comme un point dur :
il disparaît si les deux côtés partagent **une** file plutôt que de prendre deux
verrous. C'est `lockKey`, et c'est trois champs.

## Hors périmètre, explicitement

- Le contrôle de surcharge au commit (**QA-120**) — trou identique sur la banque,
  donc correctif commun, donc pas ici.
- L'interruption réactive par un combat ou une téléportation (**QA-121**) :
  constatée au commit, pas annoncée.
- La liste noire et le bouton « Ignorer » (**QA-122**).
- Les autres entrées du menu joueur : listées et grisées, non branchées.
- Le contrôle d'adjacence (**QA-114**) : on contrôle la carte, comme partout
  ailleurs dans ce serveur.
- Le glisser-déposer entre grilles : double-clic et menu contextuel, comme la
  banque.
- Les types 12 / 13 (craft sécurisé), qui partagent `ER` et `EK` mais ajoutent un
  troisième panneau coopératif.
- Le lot `EMO+123|5+456|2` (multi-sélection Ctrl) : un mouvement par objet.

## Runbook

Deux clients. Le second vient du gestionnaire de bots :

```bash
just dev
cd ../dofus-bot-manager
bun run cli spawn -u bot_feca1 -p testbot1 -c Mikos --json
bun run cli teleport -n Mikos -m 7411 -c 383 --json   # la carte du personnage de dev
```

1. **Le menu.** Clic sur l'autre joueur.
   *Attendu* : son nom en titre, puis « Ignorer pour la session », « Informations »,
   « Signaler le joueur », « Ajouter à mes amis », « Ajouter à mes ennemis »,
   « Message privé », « Inviter dans mon groupe », **« Echange »**, « Défier » —
   tout grisé sauf « Echange ».
   *Échec si* : les entrées « Slap » / « Organize my shop » sont encore là.
   Cliquer sur soi-même : quatre entrées, toutes grisées.

2. **Les deux boîtes.** « Echange ».
   *Attendu* : chez le demandeur, « En attente de la réponse de X pour un
   échange... » + « Annuler ». Chez l'autre, « X te propose de faire un échange.
   Acceptes-tu ? » + « Oui » / « Non ».
   *Échec si* : les deux voient la même boîte.

3. **Les deux refus.** Rejouer l'étape 2 et cliquer « Annuler », puis la rejouer
   et cliquer « Non ».
   *Attendu* : dans les deux cas les deux boîtes disparaissent et le chat de
   chacun affiche « Echange annulé ».

4. **L'ouverture.** « Oui ».
   *Attendu* : la fenêtre s'ouvre **des deux côtés** — inventaire à gauche,
   l'offre du partenaire en haut à droite, la sienne en dessous.
   *Échec si* : l'inventaire déjà ouvert se ferme, ou une seule des deux fenêtres
   apparaît.

5. **Les offres.** Chacun double-clique des objets et propose des kamas.
   *Attendu* : chaque mouvement apparaît des deux côtés dans la bonne grille, et
   **« Accepter » se grise trois secondes à chaque changement**, y compris quand
   c'est l'autre qui bouge.
   *Échec si* : le bouton reste cliquable — c'est le seul garde-fou contre la
   substitution d'offre.

6. **La transaction.** A valide, puis B.
   *Attendu* : « Echange effectué » dans les deux chats, les deux fenêtres se
   ferment, les objets et les kamas ont changé de main **dans les deux sens**,
   pods et bourses à jour sans rechargement. Rouvrir l'inventaire des deux :
   rien n'a doublé, rien n'a disparu, et une pile reçue a fusionné avec une pile
   identique déjà portée.

7. **La remise à zéro.** A valide, puis B *ajoute* un objet.
   *Attendu* : la validation de A retombe, sa moitié de fenêtre se déteint.
   *Échec si* : l'échange se conclut sur l'offre modifiée. C'est **l'arnaque**
   que le protocole à deux validations existe pour empêcher ; si cette étape
   échoue, la fonctionnalité n'est pas livrable.

8. **L'immobilisation.** Fenêtre ouverte, tenter de se déplacer des deux côtés.
   *Attendu* : rien ne bouge. Fermer, se déplacer : normal.
   Puis **non-régression S02** : ouvrir un coffre et vérifier qu'on peut toujours
   marcher.

9. **La déconnexion.** Tuer un des deux clients fenêtre ouverte.
   *Attendu* : l'autre voit « Echange annulé », sa fenêtre se ferme, et il peut
   immédiatement en ouvrir un nouveau — le verrou d'occupation l'a bien relâché.

10. **Le redémarrage.** `docker restart dofuspixiclient-gamed-1`, échange ouvert.
    *Attendu* : soit l'échange survit avec ses deux offres, soit les deux
    fenêtres se ferment proprement.
    *Échec si* : une fenêtre reste ouverte sans état serveur derrière (QA-113).

11. **L'occupation.** Un troisième personnage demande un échange à quelqu'un déjà
    en échange — et aussi à quelqu'un qui a seulement une boîte de proposition
    en attente.
    *Attendu* : refus dans les deux cas.

12. **La carte.** Demander un échange à un joueur d'une autre carte.
    *Attendu* : refus. Puis, échange accepté, téléporter un des deux par zaap et
    valider des deux côtés. *Attendu* : l'échange est annulé, rien n'a bougé.

13. **Non-régression banque.** Banque d'Astrub : déposer, retirer, transférer des
    kamas dans les deux sens.
