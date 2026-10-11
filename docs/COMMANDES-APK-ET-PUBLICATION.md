# AGRIM — toutes les commandes : APK de test → tests → Play Store

_Toutes les commandes de ce document ont été validées contre le dépôt réel :
scripts `package.json` existants, profils `eas.json` existants, commandes
`eas-cli` 24.12.1, points d'entrée de l'API existants._

**Comment lire ce document :** les blocs se copient-collent dans un terminal,
dans l'ordre. Un bloc ★ ne se fait **qu'une seule fois** par poste de travail.
Les explications détaillées (et les pièges) sont dans
[`APK-DE-TEST.md`](APK-DE-TEST.md) et [`PUBLICATION-PLAY.md`](PUBLICATION-PLAY.md).

Résumé du parcours :

```
préparer le poste  →  contrôler le code  →  lancer l'API  →  construire l'APK
      →  installer sur le téléphone  →  tester  →  corriger  →  AAB  →  Play Store
```

---

## 0. Où se placer (toutes les commandes partent de là)

```bash
cd /chemin/vers/agrim-mobile      # adapter : c'est la racine du dépôt
```

Vérification immédiate que vous êtes au bon endroit (doit lister
`apps`, `packages`, `docs`) :

```bash
ls
```

---

## 1. ★ Préparer le poste de travail (une seule fois)

```bash
node --version        # doit afficher v20.19 ou plus
npm --version
```

Installer l'outil de build et se connecter au compte Expo :

```bash
npm install -g eas-cli
eas --version         # 24.x ou plus
eas login
eas whoami            # doit afficher le compte propriétaire du projet EAS
```

> Le projet EAS est déjà rattaché (`app.config.ts` → `projectId`, `owner`).
> Il faut donc se connecter avec le **même compte Expo** que celui qui a créé
> le projet. `eas init` n'est nécessaire que si l'on crée un projet neuf.

Installer les dépendances du monorepo et construire les contrats partagés :

```bash
npm install --no-audit --no-fund
npm run build -w @agrim/contracts
```

---

## 2. Contrôles avant de construire (2 minutes, à chaque fois)

On ne construit pas un APK sur du code dont les tests échouent.

```bash
npm run build -w @agrim/contracts
```

```bash
# API : types, lint, tests
cd apps/api
npx tsc --noEmit -p tsconfig.typecheck.json
npx eslint src prisma --max-warnings 0
npx jest --runInBand
cd ../..
```

```bash
# Mobile : types, lint, tests
cd apps/mobile
npx tsc --noEmit
npx eslint app src --max-warnings 0
npx jest
cd ../..
```

Résultat attendu, au 11 octobre 2026 :

```
API     : Test Suites: 37 passed  |  Tests: 435 passed
Mobile  : Test Suites: 33 passed  |  Tests: 289 passed
```

> **Base de test — à préparer une fois par poste** (`.env` et le client Prisma
> ne sont pas versionnés) :
>
> ```bash
> cd apps/api
> cp .env.example .env        # .env n'est jamais commité
> npx prisma generate         # le client généré n'est pas versionné non plus
> npx prisma migrate deploy   # applique les migrations
> npx tsx prisma/seed.ts      # jeux de démonstration 0700000001…06
> cd ../..
> ```
>
> Sur un réseau filtré (les moteurs Prisma se téléchargent), remplacer
> `npx prisma migrate deploy` par le script maison, qui applique exactement les
> mêmes fichiers dans le même ordre :
>
> ```bash
> DATABASE_URL="postgresql://…" node scripts/apply-migrations.cjs
> ```

---

## 3. Lancer l'API que l'APK va interroger

L'APK ne contient pas l'API : l'adresse est **figée dans le binaire au moment
du build**. Il faut donc savoir dès maintenant quelle adresse sera utilisée.

**Cas A — test à la maison/bureau, téléphone sur le même Wi-Fi :**

```bash
cd /chemin/vers/agrim-mobile/apps/api
npm run start:dev               # l'API écoute sur le port 3000
```

(La base, le client Prisma et le jeu de démonstration ont été préparés au §2 ;
l'API refuse de démarrer si `.env` est incomplet — c'est voulu.)

Dans un **second terminal**, trouver l'adresse IP du poste :

```bash
cd /chemin/vers/agrim-mobile
npm run apk:adresse
```

Exemple de sortie :

```
  ✔ 192.168.1.10     wlan0
URL à utiliser dans eas.json (profil « apk ») :
  http://192.168.1.10:3000/api/v1
```

**À faire tout de suite, depuis le navigateur DU TÉLÉPHONE :**

```
http://192.168.1.10:3000/api/v1/health
```

Doit renvoyer `{"status":"ok","database":"up",...}`. Si ça ne s'affiche pas,
l'APK ne marchera pas non plus : même Wi-Fi, pare-feu (`sudo ufw allow 3000/tcp`),
ou isolation des clients sur le réseau.

**Cas B — test à distance (4G, ou un tiers qui teste) :** exposer l'API en
HTTPS avec un tunnel, puis utiliser l'URL du tunnel.

```bash
ngrok http 3000
# ou : cloudflared tunnel --url http://localhost:3000
```

**Cas C — l'API est déjà déployée :** utiliser son URL, rien à ouvrir.

---

## 4. Inscrire l'adresse dans le profil de build

Ouvrir `apps/mobile/eas.json` et renseigner l'URL **du cas choisi** dans le
profil `apk` (et `preview` si besoin) :

```json
"apk": {
  "extends": "production",
  "distribution": "internal",
  "channel": "apk",
  "android": { "buildType": "apk" },
  "env": {
    "EXPO_PUBLIC_API_URL": "http://192.168.1.10:3000/api/v1",
    "EXPO_PUBLIC_SITE_URL": "https://agrimsarl.ci"
  }
}
```

> `buildType: "apk"` est indispensable : sans lui, EAS produit un **AAB**, qui
> ne s'installe pas à la main sur un téléphone. C'est l'erreur la plus
> fréquente.
>
> L'URL de production (`https://api.agrimsarl.ci/api/v1`) reste dans le profil
> `production` : ne la mettez pas dans `apk` si vous testez en local.

Vérifier ce qui sera réellement compilé :

```bash
cd apps/mobile
npx eas config --profile apk
```

---

## 5. Construire l'APK de test

Optionnel — clé Google Maps (sans elle, seule la carte s'affiche en gris) :

```bash
export GOOGLE_MAPS_ANDROID_KEY="AIza..."
```

Lancer le build :

```bash
cd /chemin/vers/agrim-mobile/apps/mobile
eas build --platform android --profile apk --message "APK de test $(date +%F)"
```

- Au premier build, EAS propose de **générer le keystore** : répondre **oui**.
- Le build part sur les serveurs Expo : **10 à 20 min** selon la file.
- À la fin, l'outil affiche le **lien de téléchargement** et un QR code.

Retrouver le lien plus tard :

```bash
eas build:list --platform android --profile apk --limit 5
```

Suivre un build en cours :

```bash
eas build:view --platform android
```

> **Le keystore ne doit jamais être perdu** : sans lui, impossible de mettre à
> jour l'application publiée. Pour le sauvegarder ou le consulter :
> `eas credentials` (Android → Keystore).

---

## 6. Installer l'APK sur le téléphone

**Option 1 — QR code :** le scanner avec l'appareil photo à la fin du build,
puis télécharger et installer.

**Option 2 — lien :** ouvrir le lien du build sur le téléphone, bouton
_Install_.

**Option 3 — câble USB (téléphone en mode développeur) :** télécharger le
fichier `.apk` sur le poste, puis :

```bash
adb devices             # le téléphone doit apparaître
adb install -r ~/Downloads/agrim.apk
```

Android affichera « Application non vérifiée » : autoriser l'installation pour
l'application qui télécharge le fichier (Chrome, Fichiers). C'est normal hors
magasin.

**Si le téléphone ne peut pas joindre l'API depuis le réseau** et que vous
testez par câble USB, il existe un raccourci :

```bash
adb reverse tcp:3000 tcp:3000
```

et l'APK est alors construit avec `http://127.0.0.1:3000/api/v1` — le téléphone
atteint le port 3000 du poste via le câble. À ne pas confondre avec un build
destiné à circuler.

---

## 7. Vérifier que tout est branché (avant les tests longs)

Depuis le navigateur du téléphone, les trois points d'entrée publics :

```
http://192.168.1.10:3000/api/v1/health
http://192.168.1.10:3000/api/v1/config/app
http://192.168.1.10:3000/api/v1/payments/methods
```

| Adresse | Ce qu'on doit voir |
|---|---|
| `/health` | `{"status":"ok","database":"up",…}` |
| `/config/app` | coordonnées, points de vente, textes de livraison publiés par AGRIM |
| `/payments/methods` | la liste des moyens de paiement configurés (déclaration manuelle) |

Si `/config/app` renvoie des valeurs de repli AGRIM, c'est que les vraies
coordonnées n'ont pas encore été publiées : c'est un **paramètre AGRIM**, pas
un bug.

---

## 8. Tester sur le téléphone (le cœur du sujet)

La liste complète et ordonnée est en §3 de
[`PUBLICATION-PLAY.md`](PUBLICATION-PLAY.md). Les points bloquants :

```bash
# Test de fermeture/réouverture : tuer l'application puis la rouvrir
adb shell am force-stop ci.agrim.mobile
adb shell monkey -p ci.agrim.mobile -c android.intent.category.LAUNCHER 1
```

```bash
# Suivre les journaux de l'application pendant les tests (utile pour un écran vide)
adb logcat --pid=$(adb shell pidof -s ci.agrim.mobile)
```

```bash
# Coupure réseau : désactiver les données du téléphone
adb shell svc data disable
adb shell svc data enable
# ou : activer le mode avion depuis le téléphone
```

```bash
# Vérifier les permissions réellement demandées par l'APK installé
adb shell dumpsys package ci.agrim.mobile | grep -A3 "requested permissions"
```

**Ce qu'il faut prouver, en plus du parcours nominal :**

1. une commande invité se crée et apparaît côté AGRIM ;
2. le client déclare une référence de transaction ;
3. la commande **reste en attente** — elle ne devient **jamais « Payée »
   toute seule** (rejouer l'écran, rouvrir l'application, attendre) ;
4. côté administration, la déclaration se vérifie et se **confirme** ou se
   **refuse avec motif** ;
5. deux confirmations rapides → une seule appliquée, la seconde est refusée ;
6. fermer l'application entre la commande et la déclaration → au retour, le
   dossier est retrouvé ;
7. mode avion pendant le devis et la déclaration → message clair, **aucune
   confirmation affichée** ;
8. refuser la localisation → l'application reste utilisable.

Consigner chaque test : ce qui n'est pas exécuté n'est pas déclaré.

---

## 9. Corriger pendant la phase de test

**Changement JS/TS seul** (écran, texte, logique, appel API) — pas de nouveau
build, pas de réinstallation :

```bash
cd /chemin/vers/agrim-mobile/apps/mobile
eas update --channel apk --message "correction : libellé du bouton panier"
```

Rouvrir l'application **deux fois** : la première vérifie et télécharge, la
seconde affiche la version corrigée.

**Changement natif** (permission, module, icône, plugin, `app.config.ts` sur
`android`/`ios`) — nouveau build obligatoire, et incrémenter `version` :

```bash
cd /chemin/vers/agrim-mobile/apps/mobile
eas build --platform android --profile apk
```

Vérifier les updates publiées :

```bash
eas update:list --channel apk --limit 10
```

---

## 10. Passer en version de production (AAB)

**Uniquement après que les tests du §8 sont faits et que l'AGRIM a donné son
accord explicite.**

1. Contrôler une dernière fois le code (§2 : tests + lint) — tout doit être vert.
2. Relire ce qui va dans le binaire :

```bash
cd /chemin/vers/agrim-mobile/apps/mobile
npx expo config --type public | head -60
```

3. Vérifier/poser les versions. EAS gère le numéro de build à distance
   (`appVersionSource: remote` + `autoIncrement: true` sur le profil
   `production`) :

```bash
eas build:version:get --platform android
```

Pour fixer explicitement une version avant un envoi au magasin :

```bash
eas build:version:set --platform android --profile production
```

> `versionCode` déjà utilisé = refus de Google. En cas de doute, laisser
> `autoIncrement` faire son travail et noter la valeur produite.

4. Construire l'AAB :

```bash
eas build --platform android --profile production --message "1.0.0 — publication AGRIM"
```

5. Contrôler la signature conservée (doit être le même keystore que l'APK) :

```bash
eas credentials
```

---

## 11. Envoyer sur le Play Store

Configuration déjà en place dans `eas.json` : piste **interne**, en
**brouillon** (`track: "internal"`, `releaseStatus: "draft"`) — l'envoi ne
publie donc rien publiquement.

```bash
cd /chemin/vers/agrim-mobile/apps/mobile
eas submit --platform android --profile production
```

Ou, à partir d'un AAB déjà produit (identifiant ou chemin) :

```bash
eas submit --platform android --path ./build-1.0.0.aab
```

Ensuite, dans la Play Console : compléter la fiche (description, icône 512×512,
bandeau, captures d'écran), la **Sécurité des données**, l'**URL de politique de
confidentialité**, le public cible et la classification de contenu — le détail
est en §4 de [`PUBLICATION-PLAY.md`](PUBLICATION-PLAY.md).

**On ne promeut en production qu'après validation d'AGRIM.**

---

## 12. Après la publication

```bash
# Suivre les plantages et les statistiques d'installation
# → Play Console → Qualité → Plantages

# Vérifier côté API que l'essentiel fonctionne
curl -s https://api.agrimsarl.ci/api/v1/health
curl -s https://api.agrimsarl.ci/api/v1/config/app | head -40
```

Points à surveiller les premiers jours : création de commandes, déclarations de
paiement, confirmations/refus, refus de codes promo (motifs), erreurs 5xx.

---

## 13. Dépannage express

| Symptôme | Cause probable | Commande / action |
|---|---|---|
| Le fichier téléchargé ne s'installe pas | Un AAB a été produit | vérifier `"buildType": "apk"` dans le profil : `npx eas config --profile apk` |
| « Impossible de joindre le serveur » sur tous les écrans | URL d'API inaccessible depuis le téléphone | tester `/health` dans le navigateur du téléphone |
| Écran vide mais l'API répond | trafic HTTP bloqué par Android | l'URL doit commencer par `http://` **au moment du build** (`usesCleartextTraffic` la suit) |
| Carte grise sur les écrans de suivi | clé Google Maps absente ou mal restreinte | `export GOOGLE_MAPS_ANDROID_KEY=…` puis rebuild (package `ci.agrim.mobile` + SHA-1 via `eas credentials`) |
| `eas update` publiée mais l'app ne change pas | APK construit avant EAS Update, ou canal différent | reconstruire une fois l'APK ; rouvrir l'app deux fois ; `eas update:list --channel apk` |
| `eas build` : « project not configured » | mauvais compte Expo | `eas whoami`, puis `eas login` avec le compte propriétaire |
| Tests API en échec : base injoignable | PostgreSQL arrêté ou `.env` absent | `cp apps/api/.env.example apps/api/.env`, puis `npx prisma migrate deploy` |

---

## 14. Rappels non négociables

- **Aucune version n'est publiée sans validation explicite d'AGRIM.**
- L'API de production doit être en **HTTPS** : un APK pointant sur du HTTP
  public ferait circuler les identifiants en clair.
- **Aucun secret dans le bundle** : clés de paiement, jetons de notification et
  numéros de réception vivent côté serveur et sont lus par l'API.
- Les valeurs commerciales (prix, formats, disponibilité, zones, frais, numéro
  de réception, bénéficiaire, contacts) sont des **paramètres AGRIM** : elles se
  publient depuis l'administration, sans reconstruire l'application.
