# Phase 16 — Espace gestionnaire (back-office)

Rôles concernés : `GESTIONNAIRE`, `ADMIN`, `DG`.

## Périmètre

Le gestionnaire pilote la commande **du bureau**, c'est-à-dire jusqu'à ce
qu'elle soit prête et confiée à un livreur. Il surveille le stock et déclenche
l'assignation. Ce qui se passe sur la route appartient au livreur.

| Il fait | Il ne fait pas |
| --- | --- |
| Confirmer, préparer, marquer prête | Passer en `OUT_FOR_DELIVERY` ou `DELIVERED` |
| Assigner un livreur à une commande `READY` | Saisir une preuve de livraison |
| Annuler avec restitution du stock | Annuler une commande déjà partie |
| Ajuster le stock par apport ou retrait | Fixer un stock en valeur absolue |

Frontière appliquée côté serveur : toute tentative de transition terrain depuis
le back-office renvoie **409 `MANAGER_ACTION_NOT_ALLOWED`**. La garde de route
mobile (`Stack.Protected`) n'est qu'un confort d'interface.

## Décisions

**Le stock s'ajuste par `delta`, jamais par valeur absolue.** Deux gestionnaires
qui reçoivent chacun une palette en même temps doivent aboutir à deux palettes
ajoutées, pas à un écrasement mutuel. L'incrément est atomique en base ; un
résultat négatif est refusé (`STOCK_CANNOT_BE_NEGATIVE`). Prouvé : cinq apports
concurrents de 10 sur un stock de 100 donnent 150.

**Le seuil d'alerte est porté par la variante**, pas par la configuration
globale : un sac de 22,5 kg et un sachet de 900 g n'ont pas la même rotation.
Colonne `ProductVariant.lowStockThreshold` (migration
`20260818150722_variant_low_stock_threshold`).

**Niveaux dérivés** (`stockLevel`, contrat partagé) : `OUT` à zéro, `CRITICAL`
sous la moitié du seuil, `LOW` sous le seuil, `OK` au-delà. La règle vit dans
`@agrim/contracts` pour que l'écran et l'API ne divergent jamais.

**`READY` n'est pas un état terminal du bureau** : il attend une assignation.
Le tableau de bord distingue explicitement « prête » et « prête sans livreur »
via `awaitsCourierAssignment` et le drapeau `hasCourier`.

**Chiffre d'affaires du jour hors commandes annulées.** `stalePendingCount`
compte les commandes en attente depuis plus de 60 minutes — l'indicateur qui
révèle un oubli.

**L'annulation par le gestionnaire restitue le stock** dans la même transaction
que le changement de statut.

**L'assignation est déclenchée du back-office mais implémentée dans le module
livraisons** : une seule écriture de la logique d'affectation, quel que soit
l'appelant.

## API

| Méthode | Route |
| --- | --- |
| GET | `/management/dashboard` |
| GET | `/management/orders?status&search` |
| GET | `/management/orders/:reference` |
| PATCH | `/management/orders/:reference/status` |
| GET | `/management/stock?onlyAlerts` |
| PATCH | `/management/stock/:variantId` |
| GET | `/management/couriers` |
| GET | `/producers/productions/review?status` |
| PATCH | `/producers/productions/:id/review` |

## Mobile

`app/gestion/` : `index.tsx` (tableau de bord + file de commandes),
`[reference].tsx` (détail, appel client, avancement ou assignation, annulation),
`stocks.tsx` (liste, alertes, apport), `recoltes.tsx` (revue des déclarations de
production). Accès par l'onglet Compte → « Tableau de bord ». Le détail se lit
dans le cache de la file — aucune requête supplémentaire à l'ouverture.

## Revue des récoltes

La phase 15 avait livré `PATCH /producers/productions/:id/review` sans aucune
liste : le gestionnaire ne pouvait pas connaître les identifiants à examiner, la
boucle producteur → coopérative restait donc ouverte. Elle est fermée ici.

`GET /producers/productions/review` renvoie, tous producteurs confondus, les
déclarations `DECLARED` et `CONFIRMED` — la file de travail, pas l'historique —
**les plus anciennes d'abord**, car une déclaration oubliée bloque un
producteur. Chaque ligne porte le nom et le téléphone de l'exploitant :
arbitrer suppose de pouvoir l'appeler, information absente de
`productionSchema` (d'où `reviewableProductionSchema`).

L'écran dérive l'action proposée de `canTransitionProduction` plutôt que de
tester le statut à la main : vérifier, puis acter la réception. **Le rejet exige
un motif**, contrôlé dans le contrat partagé, dans l'écran et à nouveau par le
serveur.

Contrats : `packages/contracts/src/management.ts`.
Client : `apps/mobile/src/api/management.ts` (`useManagerDashboard`,
`useManagedOrders`, `useCouriers`, `useUpdateOrderStatus`, `useAssignCourier`,
`useStock`, `useAdjustStock`).

## Vérifications

- API : **177** tests verts (22 `management`, 23 `producers`), ESLint et
  typecheck propres.
- Mobile : **176** tests RNTL verts, ESLint (nouvellement activé) et
  `tsc --noEmit` sans erreur.
- `expo-doctor` : 21/21.
- Bundle Android : 1 951 modules, statut 200.

Cas prouvés côté API : client et livreur reçoivent 403 ; absence de jeton, 401 ;
étape sautée, 409 `INVALID_ORDER_TRANSITION` ; commande partie, 409
`ORDER_NOT_CANCELLABLE` ; concurrence sur le stock ; fiabilité de `hasCourier`.
