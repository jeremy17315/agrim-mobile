# Construire un APK de test AGRIM

Objectif : un fichier `.apk` installable à la main sur un téléphone Android,
pour tester l'application sur le terrain.

Durée : **30 à 45 min** la première fois (création du compte Expo, clé Maps),
**10 min** les fois suivantes, dont ~15 min d'attente de build.

---

## Avant de commencer : la question qui décide de tout

Un APK n'embarque pas l'API. L'application devra joindre le backend **par le
réseau**, et l'adresse est figée dans le binaire au moment du build.

`localhost` ne fonctionnera pas : sur un téléphone, `localhost` désigne le
téléphone lui-même. Trois situations, à trancher maintenant :

| Situation                                            | URL à utiliser                        | Remarque                                                               |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| **A.** API sur votre PC, téléphone sur le même Wi-Fi | `http://192.168.x.x:3000/api/v1`      | Le plus simple. Ne marche qu'à la maison / au bureau.                  |
| **B.** API exposée par un tunnel                     | `https://xxxx.ngrok-free.app/api/v1`  | Marche partout, y compris en 4G. Idéal pour faire tester par un tiers. |
| **C.** API déployée sur un serveur                   | `https://api.votre-domaine.ci/api/v1` | Pour une vraie campagne de test.                                       |

Pour les premiers tests, prenez **A**. Passez à **B** dès que quelqu'un d'autre
que vous doit tester.

> **Ne construisez pas un APK pointant sur une API accessible publiquement en
> HTTP simple.** Les identifiants circuleraient en clair. HTTP est toléré ici
> uniquement sur un réseau local privé, le temps des tests.

---

## Étape 1 — Prérequis (une seule fois)

Sur la machine de développement :

```bash
node --version    # 20 ou plus
npm --version
```

Créez un compte Expo si vous n'en avez pas : <https://expo.dev/signup>
(gratuit ; le plan gratuit inclut des builds Android en file d'attente).

Installez l'outil et connectez-vous :

```bash
npm install -g eas-cli
eas login
eas whoami        # doit afficher votre identifiant
```

---

## Étape 2 — Lier le projet à votre compte Expo

```bash
cd agrim-mobile/apps/mobile
eas init
```

La commande crée un projet côté Expo et affiche un **project ID**
(`xxxxxxxx-xxxx-...`). Notez-le.

`app.config.ts` lit cet identifiant depuis l'environnement, pour ne pas figer
dans le dépôt un identifiant lié à votre compte personnel. Exportez-le :

```bash
export EAS_PROJECT_ID="collez-ici-le-project-id"
```

Pour ne pas le retaper à chaque session, ajoutez cette ligne à votre
`~/.bashrc` (ou `~/.zshrc`).

> Cet identifiant sert aussi aux notifications poussées : sans lui,
> `usePushRegistration` ne peut pas obtenir de jeton et le push restera
> silencieux. L'application reste utilisable, les notifications restent
> consultables dans l'écran dédié.

---

## Étape 3 — Trouver l'adresse de votre API

Sur la machine qui exécute l'API :

```bash
cd agrim-mobile
npm run apk:adresse
```

Le script liste les adresses de la machine, écarte les interfaces virtuelles
(Docker, VM) qui ne sont pas joignables depuis un téléphone, et propose l'URL
à utiliser. Exemple :

```
  ✔ 192.168.1.10     wlan0

URL à utiliser dans eas.json (profil « apk ») :
  http://192.168.1.10:3000/api/v1
```

**Vérifiez depuis le téléphone** avant d'aller plus loin. Démarrez l'API :

```bash
cd agrim-mobile
npm run api:dev
```

Puis, dans le navigateur **du téléphone** (même Wi-Fi), ouvrez :

```
http://192.168.1.10:3000/api/v1/health
```

Vous devez voir une réponse JSON. Si la page ne charge pas :

- le téléphone n'est pas sur le même réseau (Wi-Fi invité, partage de
  connexion, VLAN séparé) ;
- le pare-feu de la machine bloque le port 3000 :
  `sudo ufw allow 3000/tcp` sous Linux, règle entrante sous Windows ;
- le point d'accès Wi-Fi isole les clients entre eux (fréquent sur les réseaux
  publics et certaines box en mode « isolation AP »).

Tant que cette page ne s'affiche pas sur le téléphone, l'APK ne fonctionnera
pas. C'est le meilleur test possible, et il coûte 30 secondes.

---

## Étape 4 — Inscrire l'URL dans le profil de build

Ouvrez `apps/mobile/eas.json` et remplacez l'URL du profil `apk` :

```json
"apk": {
  "extends": "production",
  "distribution": "internal",
  "channel": "apk",
  "android": { "buildType": "apk" },
  "env": {
    "EXPO_PUBLIC_API_URL": "http://192.168.1.10:3000/api/v1"
  }
}
```

Deux points expliquent ce profil :

- `"buildType": "apk"` — sans lui, EAS produit un **AAB**, format destiné au
  Play Store et **non installable** directement sur un téléphone. C'est la
  confusion la plus fréquente.
- `distribution: "internal"` — génère un lien de téléchargement direct, sans
  passer par un magasin.

---

## Étape 5 — Clé Google Maps Android (pour les écrans d'itinéraire)

Les écrans de suivi affichent une carte via `react-native-maps`, qui utilise
Google Maps sur Android. **Sans clé, la carte s'affiche en gris** : les écrans
paraissent cassés alors que le code est correct.

1. Console Google Cloud → créez un projet.
2. Activez **Maps SDK for Android**.
3. _Identifiants_ → _Créer_ → _Clé API_.
4. Restreignez la clé (important) : _Restriction d'application_ → **Applications
   Android**, puis ajoutez :
   - nom du package : `ci.agrim.mobile`
   - empreinte SHA-1 : obtenue par `eas credentials` (Android → _Keystore_),
     après le premier build.

Passez la clé au build :

```bash
export GOOGLE_MAPS_ANDROID_KEY="AIza..."
```

`app.config.ts` l'injecte seulement si elle est définie. Elle n'est **jamais
commitée** : elle vient de l'environnement.

> Pour un tout premier APK, vous pouvez sauter cette étape. Tout fonctionnera
> sauf la carte. Le reste du suivi (statuts, position en texte) reste lisible.

---

## Étape 6 — Lancer le build

```bash
cd agrim-mobile/apps/mobile
eas build --platform android --profile apk
```

Au premier lancement, EAS demande à générer un **keystore** (la signature de
l'application) : répondez **oui**. Expo le conserve et le réutilisera.

> Gardez ce keystore. Si vous publiez un jour sur le Play Store, le perdre vous
> empêcherait de mettre à jour l'application — Google refuse une application
> resignée avec une autre clé. `eas credentials` permet de le sauvegarder.

Le build part sur les serveurs Expo (10 à 20 min selon la file d'attente). À la
fin, l'outil affiche un lien et un QR code.

Pour retrouver le lien plus tard :

```bash
eas build:list --platform android --limit 5
```

---

## Étape 7 — Installer sur le téléphone

**Option 1 — QR code (le plus simple).** Scannez le QR code affiché à la fin du
build avec l'appareil photo du téléphone, puis téléchargez le fichier.

**Option 2 — Lien.** Ouvrez le lien de build sur le téléphone, bouton
_Install_.

**Option 3 — Câble USB**, si le téléphone est en mode développeur :

```bash
adb install chemin/vers/agrim.apk
```

À l'installation, Android affichera **« Application non vérifiée »** ou
**« Sources inconnues »**. C'est normal pour un APK hors magasin : autorisez
l'installation pour l'application qui télécharge le fichier (Chrome, Fichiers).

---

## Étape 8 — Vérifier que tout est branché

Dans l'ordre, avec l'API démarrée sur la machine :

1. **Ouverture de l'application** — le splash vert AGRIM apparaît.
2. **Catalogue** — les produits RIZ BOAGNI s'affichent.
   Écran vide ou erreur réseau ⇒ le problème est l'URL de l'API, pas
   l'application. Reprenez l'étape 3.
3. **Connexion** — `0700000001` / `Agrim2026!` (client de démonstration).
4. **Commande complète** — panier, adresse, validation.
5. **Parcours livreur** — connectez-vous en `0700000002` sur un second
   téléphone (ou déconnectez-vous et reconnectez-vous) pour suivre la course.
6. **Code de livraison** — côté client, écran de suivi ; côté livreur, saisie à
   l'arrivée.

Comptes de test (mot de passe commun `Agrim2026!`) :

| Téléphone    | Rôle               |
| ------------ | ------------------ |
| `0700000001` | Client             |
| `0700000002` | Livreur            |
| `0700000003` | Producteur         |
| `0700000004` | Gestionnaire       |
| `0700000005` | Administrateur     |
| `0700000006` | Direction générale |

Si la base est vide : `npm run db:seed`.

---

## Reconstruire après une modification

Le code JavaScript est figé dans l'APK. Toute modification de l'application
exige un nouveau build :

```bash
eas build --platform android --profile apk
```

**Sauf** si vous changez uniquement l'URL de l'API pendant une session de
test : dans ce cas, préférez le mode développement, qui recharge sans
reconstruire.

```bash
cd apps/mobile
npx expo start --tunnel
```

Cela suppose un **development build** installé sur le téléphone :

```bash
eas build --platform android --profile development
```

C'est la bonne façon de travailler au quotidien : un seul build, puis
rechargement instantané à chaque modification. Le profil `apk` sert à figer une
version à faire tester par quelqu'un d'autre.

---

## Problèmes fréquents

| Symptôme                                                 | Cause                                     | Solution                                                                                 |
| -------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| « Impossible de joindre le serveur » sur tous les écrans | URL d'API inaccessible                    | Étape 3, testez `/health` depuis le navigateur du téléphone                              |
| Le fichier téléchargé ne s'installe pas                  | Un AAB a été produit                      | Vérifiez `"buildType": "apk"` dans le profil                                             |
| Carte grise sur les écrans de suivi                      | Clé Google Maps absente ou mal restreinte | Étape 5 ; vérifiez package et SHA-1                                                      |
| Requêtes en échec alors que `/health` répond             | Trafic HTTP bloqué par Android            | `usesCleartextTraffic` suit l'URL : elle doit commencer par `http://` au moment du build |
| Aucune notification poussée                              | `EAS_PROJECT_ID` non défini au build      | Étape 2 ; le push exige un vrai appareil, jamais un émulateur                            |
| GPS immobile                                             | Permission refusée, ou test en intérieur  | Réglages Android → AGRIM → Localisation                                                  |
| `eas build` : « project not configured »                 | `eas init` non exécuté                    | Étape 2                                                                                  |

---

## Ce que cet APK n'est pas

- **Pas une version de production.** Elle parle à une API de développement,
  avec des données de démonstration et un jeu de comptes connus.
- **Pas publiable en l'état.** Pour le Play Store, il faut le profil
  `production` (AAB), une API en HTTPS, et le retrait du seed.
- **Pas signée pour la mise à jour du Play Store** tant que le keystore n'a pas
  été enregistré chez Google.

Les paiements restent en mode simulé : aucune clé de fournisseur réel n'est
intégrée, conformément aux consignes du projet.
