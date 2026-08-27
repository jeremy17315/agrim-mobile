# Logo officiel AGRIM — fichiers sources

Les trois variantes fournies par AGRIM, telles quelles. Tous les visuels de
l'application et du site en sont derives : ne pas les modifier, les remplacer.

| Fichier | Contenu |
| --- | --- |
| `fond-blanc.png` | epi vert clair + texte vert fonce, sur blanc |
| `fond-vert.png` | logo blanc sur fond vert profond |
| `fond-vert-bicolore.png` | epi vert clair + texte blanc, sur vert profond |

> Malgre l'extension `.png`, ce sont des **JPEG** (1658 x 624). Ils n'ont donc
> aucune transparence : les visuels detoures sont reconstruits a la demande.

## Couleurs de la charte

Relevees par histogramme sur `fond-blanc.png`, en isolant l'epi du texte :

| Usage | Teinte |
| --- | --- |
| Epi | `#52B01A` |
| Texte AGRIM | `#187018` |
| Fond de la variante verte | `#0A5410` |

## Ce qui en derive

**Application** — les six fichiers de `apps/mobile/assets/`, references par
`app.config.ts`. Deux contraintes a ne pas perdre :

- `adaptive-icon.png` doit rester **sans canal alpha** : l'App Store rejette
  toute icone qui en comporte, meme entierement opaque, et le refus arrive a
  la soumission sans explication utile.
- `splash-icon.png` porte le texte en **blanc** : l'ecran de demarrage a un
  fond vert fonce (`#0B5D1E`), ou le vert de la charte serait invisible.

**Site** (`../riz-boigni/frontend/img/`) — `agrim-logo-officiel.png`,
`favicon-officiel.png` et `agrim.png`.

## Regenerer

Il faut `sharp` : `npm install --no-save sharp`. Le detourage suit la quantite
d'encre plutot qu'un seuil franc — sur un JPEG, un seuil net produirait un
escalier autour des feuilles.

## Limite connue

Ces sources sont **matricielles**. Le site affichait auparavant un logo
vectoriel : le passage au raster reste net aux tailles d'affichage actuelles,
mais un `.svg` ou `.ai` officiel serait superieur. A demander si l'occasion
se presente.
