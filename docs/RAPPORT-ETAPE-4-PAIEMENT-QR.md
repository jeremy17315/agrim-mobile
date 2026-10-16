# Rapport — Étape 4 : les comptes marchands MTN, Orange et Wave avec leur QR

**Date** : 16 octobre 2026
**Branche** : `arena/c9a9604c-agrim-mobile`
**Statut** : implémenté et vérifié — **en attente de votre validation**.

---

## 1. Le problème réglé

Vous l'avez demandé : « dans l'application, les contacts MTN, Orange et Wave marchand avec leur code QR,
pour ceux qui aimeront scanner ».

L'application connaissait déjà la **notion** de compte marchand — c'est elle qui affiche le numéro
officiel sur l'écran de paiement, et ce numéro vient du serveur. Mais :

1. **Aucun écran ne les rassemblait.** Pour connaître le numéro MTN, Orange ou Wave, il fallait avoir une
   commande en cours de paiement. Un client qui veut payer, ou vérifier où il enverra son argent, n'avait
   nulle part où regarder.
2. **Le QR n'existait nulle part.** Ni en base, ni dans le contrat, ni dans l'écran de paiement. Le client
   devait recopier onze chiffres à la main — source d'erreur classique, et le motif de votre demande.

---

## 2. Ce qui a été implémenté, en clair

| # | Ce qui apparaît | Où |
|---|---|---|
| 1 | Écran **« Payer AGRIM »** : un bloc par compte marchand publié (MTN MoMo, Orange Money, Wave) avec le **numéro officiel**, le **bénéficiaire**, les **instructions**, un bouton **copier le numéro** et le **QR marchand** | Nouvel écran `/paiement/moyens`, ouvert depuis **Mon compte** et depuis le **panier** |
| 2 | Bloc **« OU SCANNEZ LE QR DU COMPTE »** sur l'écran de paiement d'une commande, sous le numéro officiel | `/paiement/[reference]` |
| 3 | Le **QR marchand** : l'application réaffiche, tel quel, le contenu publié par AGRIM pour ce compte | Les deux écrans ci-dessus |

**Les trois règles tenues par le code :**

- **Aucun numéro n'est inventé.** Sans publication côté AGRIM, l'écran le dit (« AGRIM n'a pas encore
  publié de compte marchand… ») et propose l'appel : il n'affiche jamais un numéro qu'il ne connaît pas.
- **Aucun QR n'est inventé.** Le QR est réencodé à partir du contenu **exact** que vous publiez pour ce
  compte — un carré vide ou un QR d'un autre compte serait pire qu'une absence. Sans contenu publié,
  l'écran écrit : « Le QR de ce compte n'est pas encore publié. Recopiez le numéro ci-dessus… ».
- **Le numéro reste la voie principale.** Le QR est une **commodité** : celui qui préfère taper ou
  appeler garde tout ce qu'il avait avant, et le montant exact et la référence restent affichés à côté.

### Choix que je vous soumets

- **Afficher seulement, sans caméra** (votre réponse) : le client scanne l'écran avec l'application de
  son opérateur (MTN MoMo, Orange Money, Wave). Aucune dépendance native, ça fonctionne aussi dans
  l'aperçu web. Si vous voulez plus tard **scanner depuis l'application AGRIM** (caméra), c'est un autre
  travail : dépendance native + version à reconstruire.
- **QR d'identité marchande, pas de montant** (votre réponse) : un seul QR par opérateur, valable pour
  toutes les commandes ; le montant exact reste écrit à côté, comme aujourd'hui. Un QR « avec montant
  pré-rempli » changerait à chaque commande et exigerait le format exact de lien de chaque opérateur.
- **Deux entrées, aucune sur l'accueil** : Mon compte et panier, comme la page Contact. L'accueil reste à
  une seule action.
- **Contenu du QR saisi par AGRIM** (recommandé) : vous me donnez le contenu du QR, je le publie. Un
  dépôt d'image officielle demanderait de rouvrir une route de téléversement que le projet a
  volontairement retirée. **⚠️ C'est le seul point qui manque pour que le QR apparaisse : voir §5.**

---

## 3. Fichiers touchés

### Contrat partagé (`packages/contracts`)

| Fichier | Changement |
|---|---|
| `src/payment-direct.ts` | `qrPayload` ajouté au moyen de paiement + **`PAYMENT_METHOD_LIMITS.qrPayloadMax = 1000`**, la même borne des deux côtés (serveur et formulaire). |

### API (`apps/api`)

| Fichier | Rôle |
|---|---|
| `prisma/schema.prisma` | `PaymentMethodConfig.qrPayload String? @db.VarChar(1000)` — **à côté** du numéro de réception, jamais dans le bundle mobile. |
| `prisma/migrations/20261016160000_qr_marchand_paiement/migration.sql` | **Nouvelle.** Migration strictement additive : une colonne NULLable. Les comptes existants n'ont simplement aucun QR publié. |
| `src/payments/dto/direct-payment.dto.ts` | `qrPayload` accepté à la création/mise à jour, borné à 1 000 caractères. |
| `src/payments/payment-methods.service.ts` | Le QR est servi au client (moyens actifs), visible en administration (y compris désactivés), et nettoyé à l'enregistrement : espaces retirés, **champ vidé = QR retiré**. |
| `src/payments/direct-payments.service.ts` | Les **instructions de paiement d'une commande** portent le QR : c'est là que le client scanne. |
| `src/payments/paiement-direct.e2e.spec.ts` | **2 tests ajoutés** : publication + service au client (route publique et instructions), retrait par champ vidé, refus au-delà de 1 000 caractères. |

### Mobile (`apps/mobile`)

| Fichier | Rôle |
|---|---|
| `src/components/PaymentQr.tsx` | **Nouveau.** Réaffiche le contenu publié en QR ; sans contenu, ne rend **rien**. |
| `app/paiement/moyens.tsx` | **Nouveau.** L'écran « Payer AGRIM » : comptes marchands, numéro, bénéficiaire, instructions, copie et QR. États vides et d'erreur honnêtes. |
| `app/paiement/[reference].tsx` | Bloc QR sous le numéro officiel, quand un QR est publié pour ce compte. |
| `app/_layout.tsx` | Route `paiement/moyens` déclarée (publique, comme le parcours d'achat). |
| `app/(tabs)/compte.tsx` | Entrée « Payer AGRIM : MTN, Orange, Wave et QR marchand » (visible connecté **et** déconnecté). |
| `app/(tabs)/panier.tsx` | Même entrée, à côté de l'aide. |
| `src/api/payments.ts` | Le moyen de paiement lu depuis le serveur porte `qrPayload` (valeur par défaut `null` : un serveur plus ancien n'empêche rien). |
| `package.json` + `package-lock.json` | Dépendance `react-native-qrcode-svg` (dessine le QR avec `react-native-svg`, déjà présent — rien de natif à reconstruire). |
| `src/__tests__/moyens-paiement.screen.test.tsx` | **Nouveau.** 6 tests. |
| `src/__tests__/paiement.screen.test.tsx`, `compte.screen.test.tsx`, `panier.screen.test.tsx` | 5 tests ajoutés (QR affiché tel quel, aucun QR sans publication, deux entrées). |

### Documentation

`docs/API-CONTRACT.md` : la section Paiements décrit désormais le transfert direct réel (et non plus
l'agrégateur fermé le 11 octobre), le champ `qrPayload` et les routes d'administration.

**Aucune donnée publiée** : mes essais ont utilisé des moyens de **test**, supprimés après vérification.
La base est repartie à zéro (0 compte marchand, 0 appareil).

---

## 4. Preuves

| Suite | Résultat | Avant l'étape |
|---|---|---|
| API (`npx jest --runInBand`) | **41 suites / 488 tests — 100 %** | 41 / 486 |
| Mobile (`npx jest`) | **37 suites / 326 tests — 100 %** | 36 / 315 |
| Contrats partagés | **5 suites / 47 tests — 100 %** | 5 / 47 |
| `npm run lint` (API, mobile, contrats) | **0 erreur, 0 avertissement** | — |
| `npm run typecheck` (API, mobile) | **0 erreur** | — |

**Essais réels sur l'API vive** (pas seulement en test) :

```
GET  /health                              → 200
GET  /payments/methods  (sans compte)     → {"methods":[]}      ← rien d'inventé
POST /management/payments/methods (ADMIN) → QR enregistré, espaces retirés :
                                            "https://pay.wave.com/m/DEMO_AGRIM/c/ci/"
GET  /payments/methods  (sans compte)     → 1 moyen publié, QR servi au client
POST /management/payments/methods (CLIENT)→ 403
POST (QR de 1001 caractères)              → 400 « qrPayload must be shorter… »
POST (champ vidé)                         → qrPayload = null  (QR retiré)
POST/PATCH/DELETE /notifications/devices  → 201 / {updated:true} / {removed:true}
```

**Vérifié en base** : la ligne `payment_method_configs` portait bien le QR publié (et `null` après
vidage) ; l'appareil enregistré sans compte portait le numéro `0700000009`, `userId` nul, `isActive`
vrai. **Puis nettoyage** : 0 compte marchand, 0 appareil.

**Aperçu web réellement servi** (paquet de 7 374 023 octets, HTTP 200) : il contient l'écran « Payer
AGRIM », la route `paiement/moyens`, la bibliothèque de QR (`react-native-qrcode-svg`), la légende
« Scannez avec l'application … », et les deux messages honnêtes (« AGRIM n'a pas encore publié de compte
marchand… », « Le QR de ce compte n'est pas encore publié »).

---

## 5. Comment le voir — et LA SEULE CHOSE QU'IL ME MANQUE

Dans l'aperçu, tout de suite :

1. **Mon compte** → descendre jusqu'à la carte « Besoin d'aide ? » → lien **« Payer AGRIM : MTN, Orange,
   Wave et QR marchand »**.
2. **Panier** → sous le bandeau des frais de livraison, le même lien.
3. L'écran s'ouvre. **Il affiche pour l'instant l'état honnête : « AGRIM n'a pas encore publié de compte
   marchand dans l'application. »** — c'est exact : il n'y a aucun numéro en base, et je n'en inventerai
   pas.

Pour que les blocs MTN / Orange / Wave et leurs QR apparaissent, il me faut **le contenu des QR de vos
trois comptes marchands**. Deux façons, à votre choix :

- **Le plus simple** : photographiez ou capturez le QR de chaque compte (celui que l'opérateur vous a
  remis) et envoyez-moi les **3 images**. Je les lis et je publie le contenu exact — nous n'afficherons
  que ce que vos QR contiennent déjà.
- Ou **envoyez-moi le texte/lien** que le QR contient (par exemple le lien Wave `pay.wave.com/m/…`), avec
  pour chacun : le **numéro marchand** tel qu'il doit être composé, le **nom du bénéficiaire** et, si
  vous voulez, votre phrase d'instructions.

Dites-moi aussi si les numéros doivent s'afficher dans un ordre précis (aujourd'hui : MTN, Orange, Wave
comme vous les avez cités — l'ordre se règle en administration).

---

## 6. Ce qui n'est PAS dans cette étape

- **Aucun écran dans l'application pour saisir les numéros ou les QR.** Ils se publient aujourd'hui par
  l'API d'administration (celle qui existe déjà pour les moyens de paiement). Un écran
  « Direction → Moyens de paiement » est la suite logique : vous corrigez un numéro, ajoutez un QR, sans
  passer par moi. Dites-moi si vous le voulez.
- **Aucun scan par caméra** dans l'application (votre choix).
- **Aucune image officielle de l'opérateur** (logo MTN/Orange/Wave dans le QR) : le QR est dessiné par
  l'application à partir du contenu ; visuellement il est noir et blanc, sans logo.
- **Aucun paiement automatique** : le QR identifie le compte marchand ; le client transfère depuis son
  application, puis déclare sa transaction comme avant, et AGRIM vérifie la réception.

---

## 7. Prochaine étape, dès votre validation

Dans l'ordre que vous choisirez :

1. **Publier vos comptes réels** (dès que vous m'envoyez les QR) — c'est immédiat, sans nouvelle version
   de l'application.
2. **L'écran d'administration « Moyens de paiement »** dans l'application (numéro, bénéficiaire,
   instructions, QR, activer/désactiver) — même modèle que l'éditeur de codes promo.
3. Puis la suite de la feuille de route : **remboursement**, favoris, reçu/facture, recommander,
   créneaux de livraison, carnet d'adresses, tri et filtres.

Dites-moi simplement « valider », ou corrigez ce qui doit l'être.
