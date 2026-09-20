/**
 * Commutateur de propriété du stock — le cœur de la bascule SSOT.
 *
 * ── Ce que vaut chaque mode ────────────────────────────────────────────
 * `site` (défaut)  — le SITE possède le stock : chaque commande réserve à
 *                    distance (`catalog-sync`), l'annulation libère chez le
 *                    site. C'est l'architecture de transition en vigueur.
 * `local`          — CETTE base possède le stock : décrément transactionnel
 *                    verrouillé (`common/stock/reserve-stock.ts`), aucune
 *                    réservation distante, aucune dépendance au site.
 *
 * ── La règle de sécurité qui gouverne le commutateur ───────────────────
 * Passer en `local` tant que le site continue de décompter SON propre
 * compteur revient à gérer deux stocks pour un même entrepôt : le même sac
 * part alors deux fois, pour de vrai, chez de vrais clients. La bascule ne
 * se fait donc QUE au moment prévu par la migration (docs/refonte/08, phase
 * 4) — quand le site lit le catalogue et le stock dans cette base ou passe
 * par cette API — et en une seule opération assumée, jamais « pour essayer ».
 *
 * Défaut `site` : toute valeur inconnue ou absente retombe sur le
 * comportement actuel. Un déploiement qui oublierait la variable ne change
 * rien à la production.
 */
export type StockMode = 'site' | 'local';

export function currentStockMode(): StockMode {
  return process.env.STOCK_MODE === 'local' ? 'local' : 'site';
}
