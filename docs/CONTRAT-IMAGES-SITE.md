# Contrat d'images — site `agrimsarl.ci/belier` → application AGRIM

Document à transmettre à la personne qui gère le site (FastAPI, cPanel).
L'application et l'API **fonctionnent déjà sans ces évolutions** : elles
affichent l'image d'origine. Ce contrat rend les photos plus rapides et
garantit qu'une photo mise à jour ne reste pas figée dans le cache.

## Ce que le site expose, par produit

| Champ | Obligatoire | Rôle |
| --- | --- | --- |
| `image_url` | oui | Photo principale, URL **absolue**, HTTPS |
| `images[]` | non | Galerie, dans l'ordre voulu |
| `image_version` | recommandé | Empreinte du contenu ou date de modification |
| `image_thumb_url` | recommandé | Vignette 480 px (liste) |
| `image_large_url` | recommandé | Zoom 1600 px (fiche) |

## Règles

1. **URL absolues en HTTPS**, stables.
2. **Une URL change quand l'image change** : nom de fichier avec empreinte
   (`riz-royal-3f9a.webp`) ou `?v=<empreinte>`. Sans cela, le cache garde
   l'ancienne photo.
3. **Formats et poids** : WebP (ou JPEG). Vignette 480 px ≤ 60 Ko ; fiche
   960 px ≤ 200 Ko ; zoom 1600 px.
4. **En-têtes** : `Cache-Control: public, max-age=31536000, immutable` (via
   `.htaccess` ou le gestionnaire cPanel), compression activée.
5. **Chemins relatifs** (`/media/...`) : ils se résolvent **sous `/belier`**.
   Préférer les URL absolues.
6. **Optionnel, recommandé** : domaine derrière un CDN gratuit (Cloudflare)
   **[AGRIM]**, si AGRIM contrôle les DNS.

## Appel au changement (site → API)

Dès qu'un produit, un prix ou une photo est enregistré, appeler une fois :

    POST https://api.agrimsarl.ci/api/v1/integration/catalogue-changed
    X-Integration-Token: <même valeur que RB_SYNC_TOKEN>

Réponse `202` : l'API relance la synchronisation en arrière-plan. Détail dans
`docs/CRON-CPANEL.md`.

## Vérification

`scripts/verifier-images.mjs` (à venir) comparera les URL du site et celles de
l'application, et signalera les photos absentes, en 404 ou trop lourdes.

## À confirmer par AGRIM

- Dossier et URL exacts des médias du site **[à vérifier]**.
- Présence ou non d'un CDN **[AGRIM]**.
