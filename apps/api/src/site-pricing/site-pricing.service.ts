import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type DeliveryGrid, type DeliveryQuote, quoteDelivery } from '@agrim/contracts';

/**
 * Résolution du prix de livraison — préserver l'unicité du site.
 *
 * Le mobile et l'API doivent afficher le MÊME tarif. La grille du site est la
 * seule source de vérité ; ce service la calcule, mais ne l'écrit jamais en
 * dur.
 */

/** Une ligne envoyée au calculateur de remises du site. */
export interface RemiseLigne {
  /** Référence côté site : clé de rattachement des remises. */
  sourceRef: string | null;
  quantity: number;
}

/** Demande de remise — volume, grossiste et code promo sont jugés par le site. */
export interface RemiseInput {
  items: RemiseLigne[];
  zone: string;
  mode: 'domicile' | 'retrait';
  codePromo?: string;
  phone?: string;
}

/**
 * Réponse du calculateur du site.
 *
 * `ok` : le site a tranché (remise éventuellement nulle, code refusé compris).
 * `unavailable` : injoignable ou non configuré ⇒ AUCUNE remise n'est appliquée.
 * On ne devine jamais un rabais : c'est de l'argent réel.
 */
export type RemiseResult =
  | { status: 'ok'; remise: number; code: string | null; message: string | null }
  | { status: 'unavailable' };

@Injectable()
export class SitePricingService {
  private readonly logger = new Logger(SitePricingService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Résous la zone et retourne la quote du site.
   *
   * Un tarif en dur ici recréerait exactement la divergence que la page de
   * commande supprime : le tarif vient du site, on ne le maintient pas.
   */
  resolve(input: {
    mode: 'domicile' | 'retrait';
    city: string | null | undefined;
    grid: DeliveryGrid;
  }): DeliveryQuote {
    const zone = this.resolveZone(input.city, input.grid);
    return quoteDelivery({ mode: input.mode, zone, grid: input.grid });
  }

  /**
   * Demande au SITE la remise applicable.
   *
   * Volume, grossiste et code promo vivent dans son back office : cette API ne
   * les réimplé (les réécrire ici recréerait la divergence de prix que le
   * projet supprime). Site absent ou en erreur ⇒ `unavailable`, donc zéro
   * remise — jamais une remise inventée.
   */
  async remise(input: RemiseInput): Promise<RemiseResult> {
    const base = (this.config.get<string>('SITE_INTEGRATION_URL') ?? '').replace(/\/+$/, '');
    const token = this.config.get<string>('SITE_INTEGRATION_TOKEN') ?? '';
    if (!base || !token) return { status: 'unavailable' };

    try {
      const response = await fetch(`${base}/api/integration/remise`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Sync-Token': token,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          lignes: input.items.map((l) => ({
            reference_produit: l.sourceRef,
            quantite: l.quantity,
          })),
          zone: input.zone,
          mode: input.mode,
          code_promo: input.codePromo ?? null,
          telephone: input.phone ?? null,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return { status: 'unavailable' };

      const payload = (await response.json()) as {
        remise?: number;
        code?: string | null;
        message?: string | null;
      };

      // Le site peut renvoyer une remise invalide : on la borne plutôt que de
      // faire confiance aveuglément. Une valeur non entière ou négative est
      // traitée comme nulle — un rabais ne doit jamais créditer le client.
      const raw = payload.remise ?? 0;
      const remise = Number.isInteger(raw) && raw > 0 ? raw : 0;

      return {
        status: 'ok',
        remise,
        code: payload.code ?? null,
        message: payload.message ?? null,
      };
    } catch {
      this.logger.warn('Calculateur de remises injoignable : aucune remise appliquée.');
      return { status: 'unavailable' };
    }
  }

  /**
   * Résout la clé de zone selon la règle officielle : ville → clé, et
   * inconnue → zone par défaut. Passage en commun, pas de copie dans le
   * mobile.
   */
  private resolveZone(city: string | null | undefined, grid: DeliveryGrid): string {
    // La grille du site rend au moins la zone par défaut. Si elle est
    // absente, on ne peut pas résoudre : lever une erreur le plus tôt
    // possible.
    if (!grid.zoneParDefaut) {
      throw new Error('Grille de livraison du site sans zone par défaut');
    }
    return this.takeZone(city, grid);
  }

  private takeZone(city: string | null | undefined, grid: DeliveryGrid): string {
    const normalise = (valeur: string) =>
      valeur
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const cible = normalise(city ?? '');
    if (!cible) return grid.zoneParDefaut;

    for (const cle of Object.keys(grid.zones)) {
      const zone = grid.zones[cle];
      if (!zone) continue;
      const libelle = normalise(zone.libelle);
      if (libelle === cible) return cle;

      // « Bouaké Centre », « Bouake » vs libelle « Bouaké » : la ville saisie
      // qui CONTIENT la zone nommée appartient à cette zone, pour ne pas
      // déclarer deux règles pour un seul tarif.
      if (libelle.length >= 4 && (cible.startsWith(libelle) || cible.endsWith(libelle))) {
        return cle;
      }
    }
    return grid.zoneParDefaut;
  }
}