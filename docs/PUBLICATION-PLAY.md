# AGRIM — publier sur Google Play (procédure)

_Document de livraison — préparé le 11 octobre 2026._

Ce document dit **exactement** quoi faire, dans l'ordre, pour : construire un
APK de test, le faire valider sur un vrai téléphone, puis produire l'AAB de
publication. Il ne publie rien : la mise en ligne est un acte d'AGRIM.

> **Règle absolue : aucune version n'est publiée sans validation explicite
> d'AGRIM.**

---

## 1. Identité de l'application (déjà configurée)

| Élément | Valeur | Où |
|---|---|---|
| Nom affiché | AGRIM | `app.config.ts` → `name` |
| Identifiant de paquet | `ci.agrim.mobile` | `android.package` |
| Version commerciale | `1.0.0` | `version` |
| Code de version Android | `1` | `android.versionCode` |
| Schéma de liens | `agrim://` | `scheme` |
| Icône et splash | logo AGRIM, fond vert `#0B5D1E` | `assets/` |
| Permissions demandées | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `INTERNET` | `android.permissions` |

`versionCode` **doit être incrémenté à chaque envoi** sur le Play Store. Un code
déjà utilisé est refusé par Google. `eas.json` utilise
`appVersionSource: remote` + `autoIncrement` sur le profil `production` : EAS
incrémente pour vous, mais notez la valeur après chaque build.

---

## 2. Ce qui ne doit JAMAIS se trouver dans le build

- Clé de paiement ou identifiant d'agrégateur (le régime en vigueur n'en a plus ;
  les pilotes historiques ne tournent que côté serveur).
- Jeton de notification : il vit **sur le serveur**, jamais dans le bundle.
- Numéro de réception mobile money : **lu depuis l'API** au moment du paiement
  (l'application ne le connaît pas d'avance, et ne peut donc pas le divulguer).
- Mot de passe, code PIN, code secret mobile money : rien de tout cela n'est
  demandé ni stocké.
- `.env` de production : les valeurs publiques passent par `EXPO_PUBLIC_*`, le
  reste reste côté serveur.

Vérification avant chaque build :

```bash
cd apps/mobile
grep -rn "EXPO_PUBLIC_" app.config.ts          # uniquement des valeurs publiques
npx expo config --type public | head -60        # relire ce qui part dans le bundle
```

---

## 3. Construire un APK de test (avant toute publication)

```bash
cd apps/mobile
npx eas build --profile preview --platform android
```

- `preview` produit un **APK** (installable à la main) pointant vers
  `https://api.agrimsarl.ci/api/v1`.
- EAS renvoie une URL de téléchargement ; l'installer sur un téléphone Android
  réel (activer « installer des applications inconnues » pour la source).

### Ce qu'il faut tester sur le téléphone, dans cet ordre

1. **Ouverture** : logo puis accueil ; pas d'écran blanc.
2. **Catalogue** : les 5 produits Bélier d'Or, formats et prix cohérents avec le
   site ; images affichées.
3. **Fiche produit** : formats, disponibilité, promotion éventuelle.
4. **Panier** : ajouter, modifier, supprimer ; total recalculé par le serveur.
5. **Commande sans compte** : nom, téléphone, zone, précisions.
6. **Paiement** : les moyens proposés sont ceux publiés par AGRIM ; le numéro
   affiché est le bon ; le bouton de copie fonctionne.
7. **Déclaration** : saisir une référence de transaction ; vérifier que la
   commande **reste en attente** (jamais « payée » toute seule).
8. **Fermeture en cours de parcours** : fermer l'application entre la commande
   et la déclaration, la rouvrir, vérifier que l'écran de paiement retrouve le
   dossier.
9. **Coupure réseau** : mode avion pendant le devis et pendant la déclaration →
   message clair, aucune confirmation affichée.
10. **Contact** : appeler, WhatsApp, points de vente, FAQ.
11. **Permissions** : refuser la localisation → l'application doit rester
    utilisable (seule la carte du livreur en dépend).
12. **Côté AGRIM** : la déclaration apparaît dans « Paiements à vérifier » ;
    confirmer, puis vérifier que le client voit « paiement confirmé ».
13. **Double clic** : deux confirmations rapides côté AGRIM → une seule
    appliquée, message explicite pour la seconde.

Consigner chaque point : ce qui est vérifié est écrit, ce qui ne l'est pas n'est
pas déclaré.

---

## 4. Construire l'AAB de publication

```bash
cd apps/mobile
npx eas build --profile production --platform android
```

- `production` produit un **AAB** (`buildType: app-bundle`) signé par EAS.
- **Conserver** l'empreinte de signature (EAS la garde ; ne jamais changer de
  compte de signature après la première publication, sinon Google refuse les
  mises à jour).
- Noter la version et le `versionCode` produits.

### Configurer le Play Console (une seule fois)

1. Créer l'application : nom « AGRIM », langue par défaut français, catégorie
   « Shopping » ou « Alimentation et boissons ».
2. Renseigner la fiche : description courte et longue, icône 512×512, bandeau
   1024×500, au moins 2 captures d'écran (téléphone).
3. **Sécurité des données** : déclarer la collecte (identité, téléphone,
   adresse de livraison, historique de commandes) et le chiffrement en transit.
   Ne pas déclarer de données bancaires : l'application **n'en collecte pas**.
4. **Politique de confidentialité** : publier l'URL correspondant au texte
   français déjà rédigé (`apps/api/src/legal/legal.controller.ts`).
5. **Public cible** et **classification de contenu**.
6. Déposer l'AAB en **piste de test interne**, en brouillon
   (`eas.json` → `submit.production.android: { track: internal, releaseStatus:
   draft }`).

### Envoi

```bash
npx eas submit --profile production --platform android
```

À faire **uniquement** après validation d'AGRIM, et de préférence en piste
interne d'abord.

---

## 5. Notifications (phase 4, reportée)

La publication ne dépend pas des notifications push pour fonctionner : le
parcours d'achat, le paiement et les codes promo fonctionnent sans elles.
À activer plus tard :

1. Fournir l'identifiant du projet de notification et le jeton serveur.
2. Serveur : `PUSH_ENABLED=true`, `PUSH_PROVIDER`, jeton.
3. Reconstruire (**un changement natif impose une nouvelle version**).
4. Tester sur téléphone réel : application ouverte, en arrière-plan, **fermée**.

---

## 6. Mises à jour

- **Changement JavaScript seulement** (texte, écran) : publication OTA par EAS
  Update, sans passer par le Play Store. La politique `appVersion` du projet
  l'autorise tant que le code natif ne change pas.
- **Changement natif** (permission, module, plugin) : incrémenter `version`,
  reconstruire l'AAB, nouveau passage en revue.
- **Base de données** : `npx prisma migrate deploy` avant de servir la nouvelle
  version de l'API. Les migrations ajoutées sont additives, donc compatibles
  avec une application encore à l'ancienne version — c'est volontaire, pour
  éviter toute interruption pendant la mise à jour.

---

## 7. Après la publication

- Surveiller les plantages (Play Console → Qualité) les premiers jours.
- Vérifier côté serveur : création de commandes, déclarations de paiement,
  confirmations, refus de codes promo (motifs), erreurs 5xx.
- Ne jamais confirmer un paiement sans avoir constaté les fonds (procédure dans
  `docs/PAIEMENT-DIRECT-MANUEL.md`).
