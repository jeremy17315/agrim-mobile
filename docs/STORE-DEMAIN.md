# Play Store et App Store — ce qui est possible demain

Date : 25 août 2026.

Le **code** peut être soumis. **« En ligne demain sur les deux magasins »**
n’est vrai que si tes comptes développeur existent déjà et que tu acceptes
un dépôt en **brouillon / test interne**, pas une validation Apple en 12 h.

---

## Franc : les délais que le code ne peut pas raccourcir

| Magasin | Si le compte existe déjà | Si tu t’inscris aujourd’hui |
|---|---|---|
| **Play Store** | Dépôt possible demain en test interne (AAB). Revue production : quelques heures à 3 jours. | Compte 25 USD, validation Google **jusqu’à 48 h**. |
| **App Store** | TestFlight demain si le build iOS passe. Revue App Store : **24–72 h**, souvent plus au 1er dépôt. | Programme Apple 99 USD/an, validation **1–2 jours** avant même de pouvoir uploader. |

Sans Mac : EAS construit iOS dans le cloud. Il te faut quand même un compte
Apple Developer pour signer et soumettre.

---

## Ce que le code fait maintenant (magasin)

- Suppression de compte dans l’app (**Mon compte → Supprimer mon compte**) — **obligatoire Apple**
- Politique de confidentialité et CGU en HTTPS :
  `https://agrim-api-production.up.railway.app/api/v1/legal/confidentialite`
  `https://agrim-api-production.up.railway.app/api/v1/legal/cgu`
- Liens depuis l’écran Compte
- Localisation seulement « when in use », pas de caméra inutile
- `ITSAppUsesNonExemptEncryption: false`
- Profil EAS `production` = **AAB** (Play), pas un APK
- Checkout : le prix du **site** gagne s’il répond

---

## Demain matin — ordre réel

### 0. API en production HTTPS

Railway `agrim-api` :

```
NODE_ENV=production
DATABASE_URL=...
JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_KEY   # ≥ 32 car., distincts
PUBLIC_API_URL=https://agrim-api-production.up.railway.app
SITE_INTEGRATION_URL=https://<URL du site>
SITE_INTEGRATION_TOKEN=<le même que RB_SYNC_TOKEN>
PUSH_ENABLED=true
PAYMENT_PROVIDER=cinetpay          # ou laisser simulation + espèces
CINETPAY_*                         # compte APP, pas celui du site
```

Vérifie :

```
curl https://agrim-api-production.up.railway.app/api/v1/health
curl https://agrim-api-production.up.railway.app/api/v1/legal/confidentialite
```

### 1. Play Store (le plus réaliste demain)

1. Play Console → application créée, fiche (nom **AGRIM**, short desc, 4 captures
   téléphone 1080×1920, icône 512, graphic 1024×500).
2. Politique de confidentialité = l’URL ci-dessus.
3. Formulaire Data safety : téléphone, nom, adresse, localisation
   (quand l’app est ouverte), identifiants de compte. Pas de pub. Pas de
   vente de données.
4. Compte test reviewer : crée un vrai client (pas `0700000001` de démo).
5. Build + dépôt **brouillon / test interne** :

```bash
cd apps/mobile
eas login
eas build --platform android --profile production
eas submit --platform android --profile production
```

Le profil envoie en **piste interne, statut draft**. Tu publies à la main
quand la fiche est complète.

**Garde le keystore** (`eas credentials`). Le perdre = plus jamais de mise à jour.

### 2. App Store (TestFlight demain, Store après revue)

1. Apple Developer → App ID `ci.agrim.mobile`, fiche App Store Connect.
2. Privacy Nutrition Labels : Contact Info, Location (when in use),
   Identifiers, Purchases. Linked to user, not used for tracking.
3. URL support + confidentialité (les mêmes).
4. Captures iPhone 6,7" et 6,1" (obligatoires).
5. Compte de démo pour l’équipe de revue (identifiant + mot de passe dans
   App Store Connect → App Review Information).
6. Build :

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

La première fois, EAS te demandera tes identifiants Apple. Ensuite,
TestFlight est souvent dispo le jour même. **La revue App Store, non.**

---

## Captures à préparer ce soir (sans ça, refus fiche)

Téléphone réel, données de démo OK :

1. Catalogue (Ébène d’Or visible, 3 500 F)
2. Fiche produit
3. Panier
4. Suivi de commande
5. Compte (avec le lien confidentialité visible)

Play : 2 minimum, 8 max, JPEG/PNG 16:9 ou 9:16.  
App Store : 6,7" (iPhone 15 Pro Max) **et** 6,1" obligatoires.

Graphic Play 1024×500 : logo AGRIM sur fond `#0B5D1E`.

---

## Ce que tu ne promets pas aux magasins

- Paiement réel tant que le 2ᵉ compte CinetPay **app** n’est pas ouvert
  (callback différent du site).
- SMS tant que `SITE_INTEGRATION_TOKEN` n’est pas le jeton du site.
- « Disponible partout demain » sur iOS.

---

## Comment tu sauras que c’est déposé

1. `/health` et `/legal/confidentialite` répondent en HTTPS.
2. Un compte se crée, commande espèces, se **supprime** depuis l’app,
   et le même numéro peut se réinscrire.
3. AAB en piste interne Play (ou brouillon).
4. IPA sur TestFlight (si compte Apple déjà actif).

Le reste — revue, fiche, captures — c’est toi dans les consoles, pas le code.
