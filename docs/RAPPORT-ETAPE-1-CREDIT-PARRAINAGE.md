# Rapport — Étape 1 : le crédit de parrainage devient utilisable

**Date** : 16 octobre 2026
**Branche** : `arena/c9a9604c-agrim-mobile`
**Statut** : implémenté et vérifié — **en attente de votre validation** avant de passer à l'étape suivante.

---

## 1. Le problème réglé

Aujourd'hui, le parrain gagne bien **1 000 F** quand son filleul reçoit sa première commande… mais ce
crédit n'est **utilisable nulle part** : il n'apparaît que sur l'écran Parrainage, et aucune commande ne
peut le dépenser. C'est un solde décoratif.

Après cette étape, le crédit est **déduit automatiquement** de la commande suivante du parrain.

---

## 2. Ce qui a été implémenté, en clair

| # | Comportement | Détail |
|---|---|---|
| 1 | **Déduction automatique** | Un client connecté qui commande voit son crédit s'appliquer tout seul. Aucun code à saisir, rien à activer. |
| 2 | **Jamais de total négatif** | Le crédit est plafonné au reste à payer : 1 000 F de crédit sur un panier de 700 F ⇒ 700 F utilisés, **300 F restent sur le compte**. |
| 3 | **Avant le crédit, la remise** | Si un code promo s'applique, il s'applique d'abord ; le crédit vient en déduction du reste. |
| 4 | **Propriété du compte, pas du téléphone** | Un visiteur non connecté n'obtient **aucun** crédit, même s'il saisit le numéro de téléphone d'un parrain. Le crédit appartient au compte qui a commandé. |
| 5 | **Trace sur la commande** | La commande mémorise le montant de crédit utilisé et le compte qui l'a payé ; le paiement demandé est le montant exact restant. |
| 6 | **Rendu si annulation** | Commande annulée (par le client **ou** par le bureau) ⇒ le crédit revient sur le compte, **exactement une fois** (une seconde annulation ne double pas le remboursement). |
| 7 | **Le solde ne peut pas être dépensé deux fois** | Deux commandes lancées en même temps sur le même compte ne peuvent pas payer avec le même crédit : la somme réellement débitée ne dépasse jamais le solde. |
| 8 | **Écran Commande** | La récapitulation affiche une ligne « Crédit parrainage − 1 000 F » et le message « Il vous restera 300 F de crédit de parrainage » (ou « utilisé en totalité »). |
| 9 | **Écran Parrainage** | Le solde est présenté comme réellement dépensable, avec l'explication : « déduit automatiquement de votre prochaine commande, dès que vous êtes connecté ». |

### Choix que je vous soumets

- **Application automatique** (pas de case à cocher « utiliser mon crédit ») : c'est le comportement le plus
  simple et le plus prévisible. Si vous préférez que le client puisse **garder** son crédit pour plus tard,
  dites-le, j'ajouterai le choix au moment de la commande.
- **Le crédit ne rapporte rien au filleul** : seul le parrain touche 1 000 F (inchangé).
- **La récompense s'acquiert toujours à la première commande LIVRÉE du filleul** (inchangé).

---

## 3. Fichiers touchés

### API (`apps/api`)

| Fichier | Rôle |
|---|---|
| `src/referrals/referral-credit.service.ts` | **Nouveau.** `balance(compte)` lit le solde ; `consume(tx, compte, montant)` débite **dans la transaction de la commande**, avec un débit conditionnel (`WHERE solde >= montant`) : en cas de course, le second perd et facture le montant réellement obtenu. |
| `src/referrals/credit-refund.ts` | **Nouveau.** `refundOrderCredit(tx, commandeId)` rend au compte le crédit consommé, une seule fois (marque `creditRefundedAt`). |
| `src/referrals/referrals.module.ts` | Exporte `ReferralCreditService` pour les commandes. |
| `src/orders/orders.service.ts` | Consomme le crédit sous verrou, fige `credit` + propriétaire sur la commande, recalcule le total avec le crédit **réellement** obtenu. |
| `src/orders/guest-checkout.service.ts` | La commande invitée passe l'identité du compte connecté (le crédit suit la session, pas le numéro saisi). |
| `src/orders/cart-quote.service.ts` | Le devis renvoie `credit` (montant utilisé) et `creditBalanceXof` (solde du compte). |
| `src/orders/cart-quote.controller.ts` | `POST /cart/quote` reste public mais accepte un jeton **facultatif**. |
| `src/common/guards/optional-jwt-auth.guard.ts` | **Nouveau.** Identifie le client si un jeton valide est présent, sans jamais refuser la requête sinon (un jeton invalide = visiteur). |
| `src/common/stock/order-stock.ts` | Toute annulation (client ou bureau) passe par ici : le crédit est rendu au même endroit, dans la même transaction que la libération du stock. |
| `src/orders/checkout.service.ts` | Même règle de crédit sur le chemin de commande dormant (mode stock local). |

### Base de données

| Fichier | Rôle |
|---|---|
| `prisma/schema.prisma` | `Order.credit` (montant de crédit payé), `Order.creditUserId` (qui a payé), `Order.creditRefundedAt` (rendu ? quand ?). |
| `prisma/migrations/20261016120000_credit_parrainage/` | Migration **additive** (3 colonnes) : rien n'est supprimé ni renommé, l'ancien code continue de fonctionner. |

### Mobile (`apps/mobile`)

| Fichier | Rôle |
|---|---|
| `src/api/client.ts` | Nouvelle option `withOptionalAuth` : le jeton est joint s'il existe, sans jamais déconnecter le client si le serveur répond 401. |
| `src/api/orders.ts` | Le contrat accepte `credit` et `creditBalanceXof` (valeur 0 par défaut : un mobile à jour face à une API plus ancienne ne casse pas). |
| `app/commande/index.tsx` | Ligne « Crédit parrainage » + phrase « Il vous restera … / utilisé en totalité ». |
| `app/parrainage/index.tsx` | Solde + paragraphe expliquant la déduction automatique. |

---

## 4. Preuves

### Suites automatisées — tout est vert

| Suite | Résultat |
|---|---|
| API (`npx jest --runInBand`) | **39 suites / 464 tests — 100 %** (avant l'étape : 37 / 437) |
| dont e2e « Crédit de parrainage » | **7 cas** (voir ci-dessous) |
| dont unitaires `referral-credit` | **11 cas** |
| Mobile (`npx jest`) | **34 suites / 301 tests — 100 %** |
| Contrats partagés | **35 tests — 100 %** |
| `npm run lint` (3 espaces de travail) | **0 erreur, 0 avertissement** |
| `npm run typecheck` (API + mobile) | **0 erreur** |

Les 7 cas de bout en bout couvrent exactement les règles annoncées : devis d'un visiteur (0 F) contre devis
d'un client connecté (1 000 F) ; commande qui consomme le crédit (paiement au montant exact, solde à jour) ;
plafonnement et surplus conservé ; annulation qui rend le crédit **une seule fois** (la seconde tentative est
refusée) ; commande invitée anonyme qui n'obtient rien, même avec le numéro d'un parrain ; commande invitée
passée **connectée** qui paie avec le crédit (annulation depuis le bureau, crédit rendu) ; deux commandes
simultanées qui ne dépensent pas deux fois le même crédit.

### Contrôle manuel, sur l'API réellement servie (pas seulement les tests)

| Vérification | Résultat mesuré |
|---|---|
| Devis d'un visiteur (sans jeton) | `credit = 0`, total 10 000 F |
| Devis du client connecté (solde 2 000 F) | `credit = 2 000`, total **8 000 F**, solde encore 2 000 F (un devis ne consomme rien) |
| Commande passée connectée | Commande créée, `credit = 2 000`, `subtotal = 10 000`, `total = 8 000`, solde du compte **0**, stock décrémenté de 2 |
| Annulation par le bureau | Solde **revenu à 2 000 F**, commande marquée « crédit rendu » — pas de double remboursement |
| Commande invitée **anonyme** avec le numéro d'un parrain | `credit = 0` : le crédit ne suit jamais le numéro de téléphone |

---

## 5. Comment le voir vous-même, tout de suite

L'aperçu de l'application (Expo web) et l'API tournent dans l'environnement de démonstration :

1. Ouvrez l'aperçu, connectez-vous avec le compte de démonstration **`0700000777` / `Agrim2026!`**
   (ce compte porte **2 000 F** de crédit de parrainage).
2. Ajoutez environ 10 000 F au panier et allez à la commande : la récapitulation affiche
   **« Crédit parrainage − 2 000 F »** et **« Total à payer 8 000 F »**.
3. Validez : l'écran Parrainage affiche alors un solde de 0.
4. Faites annuler la commande : le solde des 2 000 F revient.

> Note d'environnement : dans cet aperçu, l'API tourne en **mode stock local** (`STOCK_MODE=local`),
> car le site marchand n'est pas joignable ici. C'est un réglage de démonstration, pas un changement de code ;
> en production, le mode « site » reste celui par défaut.

---

## 6. Ce qui n'est PAS dans cette étape

- La récompense du parrain s'acquiert toujours à la **première commande livrée** du filleul (inchangé).
- Pas d'**historique** du crédit (gains / dépenses ligne par ligne) : seul le solde est affiché.
- L'**écran de suivi** de commande n'affiche pas encore le crédit utilisé, et une commande passée en
  « invité connecté » n'est pas rattachée à l'historique du compte (comportement existant, indépendant du crédit).
- Pas de case à cocher « utiliser / garder mon crédit » (voir § 2, je peux l'ajouter sur demande).

---

## 7. Prochaine étape, dès votre validation

**Étape 2 — rendre la page contact accessible** : la page existe déjà mais aucun écran n'y mène.
L'entrée serait ajoutée depuis l'écran **Compte** (et éventuellement le panier en cas de problème de
livraison), sans ajouter de second bouton sur l'accueil — votre contrainte « une seule action » reste tenue.
