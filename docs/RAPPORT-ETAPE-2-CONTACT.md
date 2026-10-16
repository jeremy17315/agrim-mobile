# Rapport — Étape 2 : la page Contact et aide devient joignable

**Date** : 16 octobre 2026
**Branche** : `arena/c9a9604c-agrim-mobile`
**Statut** : implémenté et vérifié — **en attente de votre validation**.

---

## 1. Le problème réglé

L'application possède une page **Contact et aide** complète — appel direct, standard fixe, WhatsApp, e-mail,
points de vente, informations de livraison, questions fréquentes — dont **tout le contenu vient du serveur**
(l'administration corrige un numéro, l'application suit sans mise à jour).

Mais **aucun écran n'y menait**. Un client qui cherchait une boutique, une réponse à une question, ou un
numéro de rechange ne pouvait y accéder que par un chemin qu'il n'avait pas. La page était orpheline.

---

## 2. Ce qui a été fait

| # | Entrée ajoutée | Où | Pourquoi là |
|---|---|---|---|
| 1 | Lien **« Coordonnées, boutiques et questions fréquentes »** | Écran **Mon compte**, dans la carte « Besoin d'aide ? » | C'est l'endroit où l'on cherche déjà de l'aide. La carte et son lien sont visibles **connecté comme déconnecté** : un visiteur qui n'arrive pas à commander a autant besoin du numéro qu'un client. |
| 2 | Lien **« Une question sur la livraison ? Voir l'aide et les coordonnées »** | Écran **Panier**, juste sous le bandeau qui annonce que les frais de livraison sont confirmés par téléphone | La question des frais est précisément le moment où l'on veut joindre AGRIM. Le lien est présent quel que soit l'état du panier (vide ou rempli). |

**Ce qui n'a pas été touché, volontairement :**

- **L'accueil** reste à une seule action (votre contrainte).
- Le **raccourci d'appel direct** du compte (« Appeler le fixe ») est conservé : le lien complète, il ne
  remplace pas. Un test le protège.
- La page contact elle-même n'a pas été modifiée : elle fonctionnait, elle était simplement inatteignable.
- Aucun numéro n'a été écrit dans l'application : tout continue de venir de `GET /config/app`.

Un détail d'accessibilité : les deux entrées sont annoncées comme des **liens** (et non comme des boutons
d'action) aux lecteurs d'écran, contrairement au bouton d'appel qui reste une action.

---

## 3. Fichiers touchés

| Fichier | Changement |
|---|---|
| `apps/mobile/app/(tabs)/compte.tsx` | Lien vers `/contact` dans la carte « Besoin d'aide ? » (visible dans les deux états du compte). |
| `apps/mobile/app/(tabs)/panier.tsx` | Lien vers `/contact` sous le bandeau des frais de livraison. |
| `apps/mobile/src/__tests__/compte.screen.test.tsx` | **Nouveau.** 3 tests : le lien mène bien à `/contact` connecté, il y mène aussi déconnecté, et l'appel direct du standard reste en un geste. |
| `apps/mobile/src/__tests__/panier.screen.test.tsx` | 1 test ajouté : le lien du panier ouvre `/contact`. |

Aucune modification côté API ni dans les contrats partagés.

---

## 4. Preuves

| Suite | Résultat |
|---|---|
| Mobile (`npx jest`) | **35 suites / 305 tests — 100 %** (avant l'étape : 34 / 301) |
| API (`npx jest --runInBand`) | **39 suites / 464 tests — 100 %** (revérifiée, aucun changement côté API) |
| Contrats partagés | **35 tests — 100 %** |
| `npm run lint` (3 espaces de travail) | **0 erreur, 0 avertissement** |
| `npm run typecheck` (API + mobile) | **0 erreur** |

Vérification sur l'aperçu réellement servi (pas seulement en test) : le paquet web de l'application contient
bien les deux nouvelles entrées — « Coordonnées, boutiques et questions fréquentes » (Compte) et
« Une question sur la livraison ? Voir l'aide et les coordonnées » (Panier) — et la route `/contact` y est
déclarée.

---

## 5. Comment l'essayer dans l'aperçu

1. **Mon compte** → descendre jusqu'à la carte « Besoin d'aide ? » → le lien ouvre la page complète.
   Le test déconnecté se fait sans compte : l'entrée est là aussi.
2. **Panier** → sous le bandeau bleu « Les frais de livraison sont confirmés par téléphone… », le lien ouvre
   la même page.

Remarque de démonstration : dans cet environnement, l'administration n'a publié **ni boutique ni question
fréquente** (`GET /config/app` renvoie des listes vides). La page l'annonce honnêtement (« AGRIM n'a pas
encore publié de point de vente… ») au lieu d'afficher un vide ; il ne manque que les données, pas le code.

---

## 6. Ce qui n'est PAS dans cette étape

- Pas de formulaire d'écriture depuis l'application : le contact reste l'appel, WhatsApp et l'e-mail.
- Pas de nouvelle entrée dans la barre d'onglets, ni sur l'accueil.
- Les écrans de suivi de commande et de paiement gardent leurs boutons d'appel direct existants ; ils
  pourraient aussi pointer vers la page d'aide, si vous le souhaitez.

---

## 7. Prochaine étape proposée, dès votre validation

**Étape 3 — le push complet** : aujourd'hui les notifications ne peuvent pas atteindre un client qui n'a pas
de compte, et les liens stockés dans les campagnes (`linkTarget` / `linkValue`) ne sont jamais lus — un
message ne sait donc pas ouvrir un écran précis. Objectif : jeton d'appareil possible sans compte, liens
profonds réellement exploités, et écran de campagne utilisable.

Dites-moi simplement « valider », ou corrigez ce qui doit l'être.
