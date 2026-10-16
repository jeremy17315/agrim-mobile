# Rapport — Étape 4 : les comptes marchands MTN, Orange et Wave, et comment payer avec un seul téléphone

**Date** : 16 octobre 2026
**Branche** : `arena/c9a9604c-agrim-mobile`
**Statut** : implémenté et vérifié — **en attente de votre validation**.

---

## 1. Le problème réglé

Vous avez demandé les **contacts MTN, Orange et Wave marchand avec leur code QR**, « pour ceux qui
aimeront scanner ».

L'application connaissait déjà la **notion** de compte marchand — c'est elle qui affiche le numéro
officiel sur l'écran de paiement, et ce numéro vient du serveur. Mais :

1. **Aucun écran ne les rassemblait.** Pour connaître le numéro MTN, Orange ou Wave, il fallait avoir
   une commande en cours de paiement.
2. **Le QR n'existait nulle part.** Le client devait recopier onze chiffres à la main.

Et votre question, qui a tout remis à plat :

> **« Comment scanner un code QR sur mon téléphone si je n'ai pas un second téléphone ? »**

**Vous avez raison, et c'était une erreur de ma part.** Un QR affiché à l'écran ne peut être scanné
que par un **autre** appareil. Présenter le QR comme le moyen de payer revenait à proposer un geste
impossible au cas le plus courant — celui d'un client seul avec son téléphone.

---

## 2. Ce qui a été implémenté, en clair

| # | Ce qui apparaît | Où |
|---|---|---|
| 1 | Écran **« Payer AGRIM »** : un bloc par compte marchand publié (MTN MoMo, Orange Money, Wave) avec le **numéro officiel** (copiable), le **bénéficiaire**, les **instructions** et le **QR marchand** | Nouvel écran `/paiement/moyens`, ouvert depuis **Mon compte** et depuis le **panier** |
| 2 | **« PAYER AVEC WAVE »** — un bouton qui **ouvre l'application de l'opérateur** avec le compte marchand d'AGRIM déjà rempli | Les deux écrans ci-dessous |
| 3 | **Code USSD à composer**, avec le **montant exact déjà écrit** sur une commande, plus un bouton « composer » | Idem |
| 4 | **Le QR marchand**, pour qui paie depuis un autre écran | Idem |

**Quatre règles tenues par le code :**

- **Aucun numéro n'est inventé.** Sans publication côté AGRIM, l'écran le dit (« AGRIM n'a pas encore
  publié de compte marchand… ») et propose l'appel.
- **Aucun lien n'est inventé.** Seuls `http://`, `https://` et `tel:` sont acceptés — un `javascript:`
  ou un `file:` est refusé **à l'enregistrement**, pas à l'affichage.
- **Un QR au format brut ne devient jamais un lien.** Le QR marchand de MTN ou Orange est une suite de
  chiffres (`000201…`) que seul le scanner de l'opérateur sait lire. L'application n'essaie pas de
  l'ouvrir comme une adresse : elle propose alors le code USSD et le numéro. En revanche, **le QR de
  Wave contient une vraie adresse** — l'application la reconnaît et l'utilise, sans que vous ayez à
  saisir deux fois la même information.
- **On ne promet pas ce qui ne marchera pas.** **iOS bloque les codes USSD** : sur iPhone, le bouton
  « composer » n'apparaît pas, le code reste copiable, et l'écran l'écrit.

### Choix que je vous soumets

- **Afficher le QR, sans caméra** (votre premier choix) : il sert désormais à qui paie depuis un autre
  écran, ou en montrant son téléphone à un vendeur. La légende le dit explicitement. Si vous voulez
  plus tard **scanner depuis l'application AGRIM**, c'est un autre travail (caméra native + nouvelle
  version).
- **Lien puis QR, dans cet ordre** : le geste qui marche pour tout le monde d'abord, la commodité
  ensuite.
- **Deux entrées, aucune sur l'accueil** : Mon compte et panier, comme la page Contact.
- **Contenu du QR et lien saisis par AGRIM** (recommandé) : vous me les donnez, je les publie. Un
  dépôt d'image officielle demanderait de rouvrir une route de téléversement que le projet a
  volontairement retirée. **⚠️ C'est le seul point qui manque pour que tout s'affiche : voir §5.**

---

## 3. Fichiers touchés

### Contrat partagé (`packages/contracts`)

| Fichier | Changement |
|---|---|
| `src/payment-direct.ts` | `paymentUrl` ajouté au moyen de paiement ; bornes partagées (`qrPayloadMax`, `paymentUrlMax`) ; **`paymentLinkToOpen`** (le lien du téléphone, ou `null`), **`isOpenablePaymentLink`** (les trois schémas autorisés), **`buildUssdCode`** et **`ussdDialUrl`**. |
| `src/payment-direct.test.ts` | **Nouveau.** 12 tests : lien publié, repli sur un QR-lien (cas Wave), priorité du lien explicite, QR brut ⇒ aucun lien, schémas dangereux refusés, jetons USSD, dièse encodé. |

### API (`apps/api`)

| Fichier | Rôle |
|---|---|
| `prisma/schema.prisma` | `qrPayload` (1 000) **et** `paymentUrl` (500) sur `PaymentMethodConfig` — à côté du numéro, jamais dans le bundle mobile. |
| `prisma/migrations/20261016160000_qr_marchand_paiement` et `…180000_lien_paiement_marchand` | **Nouvelles.** Additives : une colonne NULLable chacune. |
| `src/payments/dto/direct-payment.dto.ts` | `paymentUrl` accepté, borné, **trimé avant validation** (un lien collé arrive avec des espaces), schéma vérifié, **champ vidé = lien retiré**. |
| `src/payments/payment-methods.service.ts` | Le lien est servi au client, visible en administration, nettoyé à l'enregistrement. |
| `src/payments/direct-payments.service.ts` | Les **instructions de la commande** portent le QR **et** le lien. |
| `src/payments/paiement-direct.e2e.spec.ts` | **4 tests ajoutés** : publication + service au client, refus des schémas dangereux, retrait par champ vidé, QR conservé quand seul le lien est vidé. |

### Mobile (`apps/mobile`)

| Fichier | Rôle |
|---|---|
| `src/components/PaymentMethodActions.tsx` | **Nouveau.** Les gestes d'un seul téléphone : ouvrir le lien de l'opérateur, copier/composer le code USSD. N'affiche que ce qui est publié ; hors commande, **ne propose aucun code qui réclame un montant** (il n'y en a pas). |
| `src/lib/paymentActions.ts` | **Nouveau.** `openPublishedLink` (rend `false` au lieu de planter quand aucune application ne répond) et `canDialUssd` (iOS exclu). |
| `src/components/PaymentQr.tsx` | La légende dit la vérité : « il faut un AUTRE écran que ce téléphone — pour payer d'ici, utilisez plutôt le lien ou le code ». |
| `app/paiement/moyens.tsx` | **Nouveau.** L'écran « Payer AGRIM ». |
| `app/paiement/[reference].tsx` | Les gestes avec le **montant exact** de la commande, puis le QR. |
| `app/_layout.tsx`, `app/(tabs)/compte.tsx`, `app/(tabs)/panier.tsx` | Route déclarée (publique) + les deux entrées. |
| `src/api/payments.ts` | Le moyen lu depuis le serveur porte `qrPayload` et `paymentUrl` (défaut `null`). |
| `src/__tests__/moyens-paiement.screen.test.tsx` | **14 tests** : numéro/bénéficiaire/QR exact, aucun numéro inventé, copie, **ouverture du lien tel quel**, repli sur un QR-lien, QR brut ⇒ aucun bouton, échec d'ouverture annoncé, aucun code avec montant hors commande, code fixe composé, iPhone informé. |
| `src/__tests__/paiement.screen.test.tsx` | **11 tests** : QR tel quel, lien ouvert, **code avec le montant réel de la commande**, aucun bouton sans publication. |
| `src/lib/paymentActions.test.ts` | **Nouveau.** Ouverture réussie / refusée sans planter, iOS exclu. |
| `package.json`, `package-lock.json` | `react-native-qrcode-svg` (dessine avec `react-native-svg`, déjà présent — rien de natif à reconstruire). |

### Documentation

`docs/API-CONTRACT.md` : la section Paiements décrit le transfert direct réel, `qrPayload`,
`paymentUrl`, `ussdTemplate` et les routes d'administration.

**Aucune donnée publiée** : mes essais ont utilisé des moyens de **test**, supprimés après
vérification. La base est repartie à zéro (0 compte marchand, 0 appareil).

---

## 4. Preuves

| Suite | Résultat |
|---|---|
| Contrats partagés | **6 suites / 59 tests — 100 %** |
| API (`npx jest --runInBand`) | **41 suites / 490 tests — 100 %** |
| Mobile (`npx jest`) | **38 suites / 339 tests — 100 %** |
| `npm run lint` (API, mobile, contrats) | **0 erreur, 0 avertissement** |
| `npm run typecheck` (API, mobile) | **0 erreur** |

**Essais réels sur l'API vive** (pas seulement en test) :

```
GET  /health                              → 200
GET  /payments/methods  (sans compte)     → {"methods":[]}      ← rien d'inventé
POST /management/payments/methods (ADMIN) → lien ET QR enregistrés, espaces retirés
GET  /payments/methods  (sans compte)     → lien, QR et code USSD servis au client
POST (paymentUrl: "javascript:alert(1)")  → 400 « doit commencer par http://, https:// ou tel: »
POST (paymentUrl: "file:///etc/passwd")   → 400, idem
POST (champ vidé)                         → paymentUrl = null, QR conservé
```

**Vérifié en base** puis **nettoyage** : 0 compte marchand, 0 appareil.

**Aperçu web réellement servi** (paquet de 7 388 188 octets, HTTP 200) : il contient l'écran
« Payer AGRIM », la bibliothèque de QR, le bouton « PAYER AVEC… », le bloc « COPIER LE CODE », la
légende du QR (« il faut un AUTRE écran que ce téléphone ») et le message d'iPhone.

---

## 5. Comment le voir — et LA SEULE CHOSE QU'IL ME MANQUE

Dans l'aperçu, tout de suite :

1. **Mon compte** → carte « Besoin d'aide ? » → **« Payer AGRIM : MTN, Orange, Wave et QR marchand »**.
2. **Panier** → sous le bandeau des frais de livraison, le même lien.
3. L'écran s'ouvre. **Il affiche pour l'instant l'état honnête : « AGRIM n'a pas encore publié de
   compte marchand dans l'application. »** — c'est exact : il n'y a aucun numéro en base, et je n'en
   inventerai pas.

Pour que les blocs MTN / Orange / Wave apparaissent, il me faut, **pour chacun des trois comptes** :

1. **Le numéro marchand**, tel qu'il doit être composé.
2. **Le nom du bénéficiaire** à afficher (ex. « AGRIM SARL »).
3. **Le lien de paiement**, si l'opérateur vous en a fourni un — c'est lui qui donne le bouton
   « PAYER AVEC … ». Pour **Wave**, c'est souvent l'adresse contenue dans le QR : envoyez-moi la photo
   du QR, je la lis et je publie les deux d'un coup.
4. **Le code USSD**, si vous en utilisez un (ex. `#144*1*1*{numéro}*{montant}#`) — dites-moi simplement
   le code, je place les jetons.
5. **La photo ou le contenu du QR**, pour qui paiera depuis un autre écran.

Dites-moi aussi si les numéros doivent s'afficher dans un ordre précis (aujourd'hui : MTN, Orange, Wave
comme vous les avez cités — l'ordre se règle en administration).

---

## 6. Ce qui n'est PAS dans cette étape

- **Aucun écran dans l'application pour saisir numéros, liens, codes ou QR.** Ils se publient par
  l'API d'administration. Un écran « Direction → Moyens de paiement » est la suite logique : vous
  corrigez un numéro sans passer par moi. Dites-moi si vous le voulez.
- **Aucun scan par caméra** dans l'application (votre choix).
- **Aucune image officielle de l'opérateur** dans le QR (logo MTN/Orange/Wave) : le QR est dessiné à
  partir du contenu, il est noir et blanc.
- **Aucun paiement automatique** : le client paie chez son opérateur, puis **déclare sa transaction**
  dans l'application, et AGRIM vérifie la réception — inchangé.

---

## 7. Prochaine étape, dès votre validation

1. **Publier vos comptes réels** (dès que vous m'envoyez numéros, liens et QR) — immédiat, sans
   nouvelle version de l'application.
2. **L'écran d'administration « Moyens de paiement »** dans l'application (numéro, bénéficiaire,
   instructions, lien, code, QR, activer/désactiver) — même modèle que l'éditeur de codes promo.
3. Puis la suite de la feuille de route : **remboursement**, favoris, reçu/facture, recommander,
   créneaux de livraison, carnet d'adresses, tri et filtres.

Dites-moi simplement « valider », ou corrigez ce qui doit l'être.
