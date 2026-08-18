# Phase 18 — Flux de bout en bout

Fichier : `apps/api/src/flows.e2e.spec.ts` (10 tests).

## Pourquoi une suite séparée

Les suites par module prouvent que chaque endpoint respecte sa règle. Elles ne
prouvent pas que les espaces **s'enchaînent** correctement. Chaque test suit ici
une commande à travers plusieurs rôles et vérifie qu'un geste posé dans un
espace se répercute là où un autre acteur le lit.

C'est précisément le type de défaut qui passe entre les mailles des tests
unitaires — et la phase en a trouvé un sérieux.

## Flux couverts

| Flux | Ce qui est vérifié |
| --- | --- |
| Commande complète | Panier → file gestionnaire → assignation → tournée livreur → suivi client → signature → livrée. Le stock est réservé à la commande. |
| Annulation | Le stock revient exactement à son niveau ; la commande quitte la file de travail. |
| Commande partie | Ni le client ni le bureau ne peuvent annuler ; le stock n'est pas recrédité ; la course reste dans la tournée. |
| Cloisonnement | Client, livreur, producteur et gestionnaire refoulés hors de leur périmètre, quel que soit le point d'entrée. |
| Récolte | Déclaration producteur → file de revue → décision → tonnage dans les indicateurs DG → décision visible par le producteur. |
| Cohérence des chiffres | Back-office et direction enregistrent la même recette pour la même commande, et la retirent tous deux à l'annulation. |
| Stock et alertes | Un réapprovisionnement fait disparaître l'alerte côté direction. |
| Notifications | Le client est notifié à chaque étape franchie. |

## Le bug trouvé : annulation d'une commande déjà partie

**Symptôme.** Un client pouvait annuler une commande en statut
`OUT_FOR_DELIVERY`. L'API répondait `201`.

**Conséquences.** Le stock était recrédité alors que la marchandise se trouvait
physiquement avec le livreur — l'entrepôt affichait des sacs qu'il n'avait pas.
La course restait `IN_TRANSIT` dans la tournée : le livreur poursuivait vers un
client persuadé d'avoir annulé. Et le chiffre d'affaires perdait une recette
pour une marchandise pourtant remise.

**Cause.** La liste des statuts annulables était **dupliquée** : une fois dans
`CLIENT_CANCELLABLE_STATUSES` (contrat partagé), une fois en dur dans
`OrdersService.cancel`. Les deux incluaient `OUT_FOR_DELIVERY`, alors que
`isCancellableByManager` l'excluait déjà pour le gestionnaire — le bureau était
protégé, le client non.

**Correction.** `OUT_FOR_DELIVERY` retiré de `CLIENT_CANCELLABLE_STATUSES`, et
le service appelle désormais `isCancellableByClient` au lieu de redéclarer la
règle. Une seule source, donc plus de divergence possible.

**Frontière retenue.** Bureau et client s'arrêtent où commence la route. Passé
la remise au livreur, la sortie se fait par le terrain : le livreur clôt la
course en échec (`FAILED`), avec un motif. Pas par un bouton dans
l'application.

Verrouillé par trois tests mobiles (`annulation-client.test.ts`), dont un qui
échouera si un futur statut est ajouté au contrat sans décision explicite
d'annulation.

## Comportements confirmés corrects

Deux échecs initiaux venaient de mes tests, pas du code :

- **Preuve puis validation en deux temps.** Enregistrer la preuve ne clôt pas
  la course ; le livreur passe ensuite `DELIVERED`. La preuve doit exister
  **avant** la validation, jamais après.
- **Ordre des contrôles.** Depuis `CONFIRMED`, viser `OUT_FOR_DELIVERY` renvoie
  `INVALID_ORDER_TRANSITION` (le cycle de vie prime) ; depuis `READY`, c'est
  bien `MANAGER_ACTION_NOT_ALLOWED` (frontière bureau/terrain).

## Vérifications

- API : **203** tests verts (10 nouveaux), ESLint et typecheck propres.
- Mobile : **192** tests verts (3 nouveaux), ESLint et `tsc --noEmit` propres.
