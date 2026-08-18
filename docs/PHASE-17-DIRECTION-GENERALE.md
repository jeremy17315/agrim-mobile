# Phase 17 — Tableau de bord de la direction

Rôles concernés : `DG`, `ADMIN`. **Pas le gestionnaire** : ces agrégats portent
sur toute l'entreprise, alors que l'espace gestionnaire est une file de travail.

## Décisions

**L'écran est en lecture seule, par construction.** Aucun hook de mutation
n'existe dans `src/api/analytics.ts` et aucun bouton d'action n'est rendu — un
test le vérifie. Décider depuis un écran d'agrégats court-circuiterait les
contrôles métier des espaces gestionnaire et livreur, où les règles sont
écrites.

**Tout est agrégé côté serveur.** Le mobile n'additionne rien. Deux
conséquences voulues : aucun montant ne peut diverger entre deux écrans, et
l'application ne télécharge pas l'historique des commandes pour en faire la
somme sur un réseau mobile.

**Le chiffre d'affaires exclut partout les commandes annulées** — elles n'ont
jamais produit de recette. Vérifié de bout en bout : annuler une commande fait
baisser le CA du montant exact.

**Aucune croissance n'est inventée depuis zéro.** `growthRate` renvoie `null`
quand le mois de référence est vide : passer de 0 à 4 millions n'est pas
« +100 % », c'est un point de départ. L'écran affiche alors « Pas de référence
le mois précédent » plutôt qu'un pourcentage trompeur.

**Les mois sans vente valent zéro, ils ne sont pas omis** : un trou dans
l'historique se lirait comme une donnée manquante, pas comme une absence de
commande.

**Les parts par gamme totalisent exactement 100 %.** Les arrondis individuels
ne tombent pas juste ; l'écart est reporté sur la part la plus élevée
(`distributionShares`).

**Périodes = mois calendaires**, pas de fenêtres glissantes : c'est la maille
dont parlent les équipes.

**`DELIVERY_SLA_HOURS = 4` est une valeur provisoire** — aucun engagement de
service n'a été arrêté avec AGRIM. Modifiable dans le contrat, sans toucher au
code.

## API

| Méthode | Route |
| --- | --- |
| GET | `/analytics/dashboard` |

Contenu : mois courant, CA et commandes du mois avec variation, nouveaux
clients, panier moyen, livraisons hors délai, alertes de stock, tonnage
réceptionné, déclarations en attente, historique 6 mois, répartition par gamme.

## Mobile

`app/direction/index.tsx` — bandeau CA, quatre indicateurs, graphique en barres
(dessiné avec des vues : aucune dépendance graphique pour six valeurs, et
`accessibilityLabel` décrivant la série), répartition par gamme, points de
vigilance. Accès par l'onglet Compte → « Direction ».

Contrats : `packages/contracts/src/analytics.ts` (`growthRate`,
`averageBasket`, `distributionShares`, `SALES_HISTORY_MONTHS`).

## Deux défauts trouvés en chemin

**Le rôle GESTIONNAIRE n'était testé nulle part.** Cinq suites e2e se
connectaient avec `0700000005`, qui est **ADMIN** dans le seed — le vrai
gestionnaire est `0700000004`. Les tests passaient, mais vérifiaient l'accès
d'un administrateur. Corrigé dans `deliveries`, `tracking`, `notifications`,
`producers` et `management`.

**Une empreinte de mot de passe illisible provoquait une 500.**
`argon2.verify` lève lorsque le hash stocké est malformé (compte hérité, donnée
corrompue) ; l'exception remontait telle quelle. La réponse correcte est 401
`INVALID_CREDENTIALS` — révéler autre chose renseignerait sur l'état du compte.
Corrigé dans `AuthService.login` et verrouillé par un test.

## Vérifications

- API : **193** tests verts (15 pour `analytics`), ESLint et typecheck propres.
- Mobile : **189** tests RNTL verts (13 pour la direction), ESLint et
  `tsc --noEmit` sans erreur.
- Bundle Android : statut 200, toutes les routes présentes.
