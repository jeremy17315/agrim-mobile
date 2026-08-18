# Phase 19 — Consolidation des tests

## Écrans couverts

| Fichier | Tests | Ce qui est vérifié |
| --- | --- | --- |
| `catalogue.screen.test.tsx` | 13 | Recherche temporisée, filtre par gamme, paramètre de navigation, états vides et erreur |
| `connexion.screen.test.tsx` | 10 | Normalisation du numéro, validation locale, messages d'erreur, navigation |

Le catalogue était prioritaire : sa logique de synchronisation du paramètre de
gamme avait été réécrite en phase 16 (suppression d'un `setState` dans un
effet) **sans aucun test** pour la couvrir.

## Le bug trouvé : les espaces de saisie rejetés

**Symptôme.** Saisir « 07 00 00 00 01 » — la forme spontanée sur mobile —
échouait à la connexion comme à l'inscription, avec le message « Numéro
ivoirien à 10 chiffres ».

**Cause.** Deux couches qui se contredisaient. Le formulaire validait
`/^(\+225)?\s?[0-9]{10}$/`, qui n'accepte **qu'un seul** espace, puis nettoyait
la valeur au moment de l'envoi (`replace(/\s/g, '')`) — un nettoyage qui
n'était jamais atteint, la validation ayant déjà rejeté la saisie. Le même
défaut existait côté API : `LoginDto` validait avant que `normalizePhone` ne
s'exécute dans le service.

La règle était en réalité écrite **quatre fois** : `phoneSchema` du contrat, le
schéma local de connexion, celui d'inscription, et les trois DTO backend.

**Correction.**
- `phoneSchema` normalise désormais **avant** de valider (`transform` puis
  `refine`) : espaces, points et tirets retirés. La valeur validée est toujours
  compacte, donc directement comparable en base.
- Les écrans de connexion et d'inscription importent `phoneSchema` et
  `passwordSchema` au lieu de redéclarer les règles.
- Côté API, un décorateur `@NormalizePhone()` normalise à l'entrée du DTO,
  avant `@Matches` — appliqué à `LoginDto`, `RegisterDto` et
  `CreateAddressDto`.

Verrouillé par un test mobile et un test e2e API.

## Amélioration d'accessibilité

Les chips de gamme du catalogue n'avaient pas de `accessibilityLabel`. Le nom
d'une gamme apparaissant aussi sur les cartes produits, rien ne distinguait le
filtre du reste de l'écran pour un lecteur d'écran. Ajout de
« Filtrer par {gamme} ».

## Limite documentée

Re-naviguer depuis l'accueil vers **la même** gamme après avoir changé de
filtre à la main ne réapplique pas le paramètre : sa valeur étant inchangée,
rien ne distingue cette navigation de la précédente. Comportement assumé —
l'écraser à chaque rendu casserait le filtre choisi manuellement, cas bien plus
fréquent. Un test documente explicitement ce choix.

## Vérifications

- Mobile : **215** tests verts (21 suites), ESLint et `tsc --noEmit` propres.
- API : **204** tests verts, ESLint et typecheck propres.

## Reste à couvrir

Écrans encore sans test RNTL : accueil, inscription, fiche produit (couverte
indirectement par `ajout-panier`), adresse de livraison, détail de commande
gestionnaire, détail de tournée. Aucun ne porte de logique métier non déjà
testée ailleurs — priorité moindre que la revue de sécurité (phase 20).
