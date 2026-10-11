import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  evaluatePromoCode,
  normalizePromoCode,
  type PromoCodeRule,
  type PromoEvaluation,
  type PromoRejectionReason,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import { SitePricingService } from '../site-pricing/site-pricing.service';
import type { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/promo-code.dto';

/** Une ligne de panier telle que la remise la voit. */
export interface RemiseLine {
  sourceRef: string | null;
  sku: string;
  unitPrice: number;
  quantity: number;
}

export interface RemiseResolution {
  /** `ok` : un montant a été décidé. `refused` : le code est refusé, remise nulle. */
  status: 'ok' | 'refused';
  /**
   * Le calculateur du SITE a-t-il répondu ?
   *
   * Quand il est injoignable, ses remises automatiques (volume, grossiste)
   * manquent : les écrans le disent au client plutôt que d'afficher un total
   * qui pourrait changer au checkout.
   */
  siteAvailable: boolean;
  /** Remise totale, en XOF entier — jamais négative, jamais > sous-total. */
  remise: number;
  /** Code effectivement appliqué (normalisé), ou `null`. */
  code: string | null;
  /** Message à afficher au client. */
  message: string | null;
  /** Motif du refus, quand `status === 'refused'`. */
  reason: PromoRejectionReason | null;
  /** La décision vient-elle de la table locale (et non du calculateur du site) ? */
  local: boolean;
}

/** Ce que le site a répondu pour les remises qu'il gère encore. */
type SiteRemise =
  | { status: 'ok'; remise: number; code: string | null; message: string | null }
  | { status: 'unavailable' };

/**
 * Le site n'a rien reconnu pour ce code : ni remise, ni code appliqué, ni
 * explication. Un site injoignable tombe dans le même cas — on ne peut pas
 * affirmer qu'un code est valable sans que personne ne l'ait confirmé.
 */
function remiseNonReconnue(site: SiteRemise, code: string): boolean {
  if (site.status === 'unavailable') return true;
  const applied = (site.code ?? '').trim().toUpperCase();
  return site.remise <= 0 && applied !== code.trim().toUpperCase() && !site.message;
}

/**
 * Codes promo — administration et application.
 *
 * Deux responsabilités, un seul endroit :
 *
 *  1. **Administration** : AGRIM crée, modifie et désactive ses codes depuis
 *     l'application. Aucun code n'est écrit dans le code source.
 *  2. **Application** : le serveur décide du rabais, à partir de la table
 *     locale, et retombe sur le calculateur du site pour les remises que le
 *     site gère encore (volume, grossiste).
 *
 * Pourquoi le local d'abord : une promotion annoncée par AGRIM doit
 * s'appliquer même si le site est injoignable. Pourquoi ne pas doubler : un
 * code connu ici n'est JAMAIS transmis au site — sinon le même rabais
 * s'appliquerait deux fois.
 */
@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SitePricingService,
  ) {}

  /* ─────────────────────────── Administration ─────────────────────────── */

  /** Liste administrable, avec un compteur d'utilisations lisible. */
  async list() {
    const codes = await this.prisma.db.promoCode.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    // `id` est ajouté ICI : l'administration en a besoin pour publier ou
    // désactiver un code (`PATCH /promo-codes/:id`). Le contrat partagé
    // `PromoCodeRule` reste, lui, une règle de calcul — sans identifiant.
    return codes.map((code) => ({ id: code.id, ...this.toRule(code) }));
  }

  async create(dto: CreatePromoCodeDto, actorId: string) {
    const code = normalizePromoCode(dto.code);
    this.assertValues(dto, code);

    const created = await this.prisma.db.promoCode
      .create({
        data: {
          code,
          description: dto.description ?? null,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          minOrderTotal: dto.minOrderTotal ?? null,
          maxUses: dto.maxUses ?? null,
          maxUsesPerPhone: dto.maxUsesPerPhone ?? null,
          zone: dto.zone ?? null,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          // INACTIF par défaut : un code promo est de l'argent offert, et le
          // brief exige que les promotions soient VALIDÉES par AGRIM avant
          // publication. Le code est donc créé, relu, puis publié
          // explicitement (`PATCH` avec `isActive: true`). Sans ce garde-fou,
          // une faute de frappe dans un montant partirait en production.
          isActive: dto.isActive ?? false,
          appliesTo: dto.appliesTo ?? [],
          createdById: actorId,
        },
      })
      .catch((error: { code?: string }) => {
        // `P2002` = contrainte d'unicité du code. Message explicite plutôt
        // qu'une erreur Prisma brute (qui ne doit jamais atteindre le client).
        if (error?.code === 'P2002') {
          throw new ConflictException({
            code: 'PROMO_CODE_EXISTS',
            message: 'Un code promo identique existe déjà.',
          });
        }
        throw error;
      });

    return this.toRule(created);
  }

  async update(id: string, dto: UpdatePromoCodeDto) {
    const existing = await this.prisma.db.promoCode.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'PROMO_CODE_NOT_FOUND',
        message: 'Ce code promo est introuvable.',
      });
    }

    this.assertValues(
      {
        discountType: dto.discountType ?? existing.discountType,
        discountValue: dto.discountValue ?? existing.discountValue,
      },
      normalizePromoCode(dto.code ?? existing.code),
    );

    const updated = await this.prisma.db.promoCode.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: normalizePromoCode(dto.code) } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.discountType !== undefined ? { discountType: dto.discountType } : {}),
        ...(dto.discountValue !== undefined ? { discountValue: dto.discountValue } : {}),
        ...(dto.minOrderTotal !== undefined ? { minOrderTotal: dto.minOrderTotal } : {}),
        ...(dto.maxUses !== undefined ? { maxUses: dto.maxUses } : {}),
        ...(dto.maxUsesPerPhone !== undefined
          ? { maxUsesPerPhone: dto.maxUsesPerPhone }
          : {}),
        ...(dto.zone !== undefined ? { zone: dto.zone } : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date() }
          : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.appliesTo !== undefined ? { appliesTo: dto.appliesTo } : {}),
      },
    });
    return this.toRule(updated);
  }

  /** Désactivation : on ne supprime pas un code utilisé — son historique compte. */
  async deactivate(id: string) {
    const existing = await this.prisma.db.promoCode.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'PROMO_CODE_NOT_FOUND',
        message: 'Ce code promo est introuvable.',
      });
    }
    const updated = await this.prisma.db.promoCode.update({
      where: { id },
      data: { isActive: false },
    });
    return this.toRule(updated);
  }

  /** Historique d'utilisation — qui a profité du code, et sur quelle commande. */
  async redemptions(id: string, limit = 100) {
    const rows = await this.prisma.db.promoCodeRedemption.findMany({
      where: { promoCodeId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return rows.map((row) => ({
      orderReference: row.orderReference,
      // Téléphone masqué : l'écran est un suivi d'usage, pas un annuaire.
      phoneMasked: maskPhone(row.phone),
      discount: row.discount,
      orderTotal: row.orderTotal,
      createdAt: row.createdAt,
    }));
  }

  /* ──────────────────────────── Application ───────────────────────────── */

  /**
   * Résout la remise applicable à un panier.
   *
   * Ordre : code local → code inconnu transmis au site → remises du site
   * (volume, grossiste). Le cumul est plafonné au sous-total : une remise ne
   * peut pas transformer un achat en crédit.
   */
  async resolveRemise(input: {
    lines: RemiseLine[];
    subtotal: number;
    zone: string;
    mode: 'domicile' | 'retrait';
    codePromo?: string;
    phone?: string;
  }): Promise<RemiseResolution> {
    const code = input.codePromo ? normalizePromoCode(input.codePromo) : null;
    const local = code ? await this.findRule(code) : null;

    // Le site ne voit JAMAIS un code géré localement : il l'appliquerait une
    // seconde fois. On lui demande donc seulement ses remises automatiques.
    const site = await this.remiseSite({
      lines: input.lines,
      zone: input.zone,
      mode: input.mode,
      codePromo: local ? undefined : input.codePromo,
      phone: input.phone,
    });

    let localDiscount = 0;
    let localCode: string | null = null;
    let message: string | null = null;

    if (code && local) {
      const evaluation = await this.evaluate(local, {
        code,
        lines: input.lines,
        subtotal: input.subtotal,
        zone: input.zone,
        phone: input.phone,
      });
      if (evaluation.status === 'ok') {
        localDiscount = evaluation.discount;
        localCode = evaluation.code;
        message = evaluation.message;
      } else {
        // Refus explicite : le client doit savoir POURQUOI il paie plein tarif,
        // et pouvoir retirer son code. On ne facture jamais en silence un
        // panier que le client croyait remisé.
        return {
          status: 'refused',
          siteAvailable: site.status === 'ok',
          remise: 0,
          code: evaluation.code,
          message: evaluation.message,
          reason: evaluation.reason,
          local: true,
        };
      }
    }

    // ── Un code saisi par le client ne peut pas être ignoré en silence ──
    //
    // Cas visé : le code n'est pas dans la table locale, et le site ne le
    // reconnaît pas non plus (il ne renvoie ni remise, ni code appliqué, ni
    // message). Accepter la commande reviendrait à laisser le client payer
    // plein tarif en croyant bénéficier d'une remise — le brief l'interdit.
    // On refuse, avec un motif lisible, et il peut retirer son code.
    if (code && !local && remiseNonReconnue(site, code)) {
      return {
        status: 'refused',
        siteAvailable: site.status === 'ok',
        remise: 0,
        code,
        message:
          site.status === 'ok'
            ? 'Ce code promo n’existe pas. Vérifiez la saisie, ou retirez-le pour commander.'
            : 'Ce code promo ne peut pas être vérifié pour le moment. Retirez-le pour commander, ou réessayez dans un instant.',
        reason: 'INCONNU',
        local: false,
      };
    }

    const siteRemise = site.status === 'ok' ? site.remise : 0;
    const remise = Math.max(0, Math.min(siteRemise + localDiscount, input.subtotal));

    return {
      status: 'ok',
      siteAvailable: site.status === 'ok',
      remise,
      // Priorité au code LOCAL quand il a été appliqué ; sinon on rapporte ce
      // que le site a annoncé (il gère encore ses propres codes).
      code: localCode ?? (site.status === 'ok' ? site.code : null),
      message: message ?? (site.status === 'ok' ? site.message : null),
      reason: null,
      local: local !== null,
    };
  }

  /**
   * Évalue un code **sans** écrire : utilisé par le devis (affichage).
   * Lève uniquement si le code est refusé — l'appelant décide quoi en faire.
   */
  async evaluateRule(input: {
    code: string;
    lines: RemiseLine[];
    subtotal: number;
    zone: string | null;
    phone?: string;
    now?: Date;
  }): Promise<PromoEvaluation | null> {
    const rule = await this.findRule(normalizePromoCode(input.code));
    if (!rule) return null;
    return this.evaluate(rule, input);
  }

  /**
   * Enregistre l'utilisation d'un code : incrément atomique conditionnel puis
   * trace. Appelé APRÈS la création de la commande.
   *
   * L'incrément est conditionnel EN SQL (`usedCount < maxUses`) : deux
   * commandes simultanées sur la dernière utilisation ne peuvent pas dépasser
   * le quota — un `read-modify-write` applicatif, lui, le pourrait.
   */
  async recordRedemption(input: {
    code: string;
    orderReference: string;
    phone: string;
    discount: number;
    orderTotal: number;
  }): Promise<{ recorded: boolean }> {
    if (input.discount <= 0) return { recorded: false };
    const code = normalizePromoCode(input.code);

    const promo = await this.prisma.db.promoCode.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!promo) return { recorded: false };

    const claimed = await this.prisma.db.$executeRaw`
      UPDATE "promo_codes"
         SET "usedCount" = "usedCount" + 1
       WHERE "id" = ${promo.id}::uuid
         AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
    `;
    if (claimed === 0) {
      // Quota épuisé entre le devis et la commande. La commande existe déjà et
      // a été facturée avec la remise : on le signale, sans la casser après coup.
      this.logger.warn(
        `Quota du code ${code} épuisé au moment d’enregistrer ${input.orderReference}.`,
      );
    }

    await this.prisma.db.promoCodeRedemption
      .create({
        data: {
          promoCodeId: promo.id,
          orderReference: input.orderReference,
          phone: input.phone,
          discount: input.discount,
          orderTotal: input.orderTotal,
        },
      })
      // Un rejeu de commande (même référence) ne doit pas doubler la trace.
      .catch(() => undefined);

    return { recorded: claimed > 0 };
  }

  /* ───────────────────────────── Interne ─────────────────────────────── */

  private async evaluate(
    rule: PromoCodeRule,
    input: {
      code: string;
      lines: RemiseLine[];
      subtotal: number;
      zone: string | null;
      phone?: string;
      now?: Date;
    },
  ): Promise<PromoEvaluation> {
    const usesByPhone = input.phone
      ? await this.prisma.db.promoCodeRedemption.count({
          where: {
            promoCodeId: await this.idOf(rule.code),
            phone: input.phone,
          },
        })
      : undefined;

    return evaluatePromoCode(rule, {
      code: input.code,
      lines: input.lines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        sourceRef: line.sourceRef,
        sku: line.sku,
      })),
      subtotal: input.subtotal,
      zone: input.zone,
      usesByPhone,
      now: input.now ?? new Date(),
    });
  }

  private async idOf(code: string): Promise<string> {
    const row = await this.prisma.db.promoCode.findUnique({
      where: { code: normalizePromoCode(code) },
      select: { id: true },
    });
    return row?.id ?? '';
  }

  private async findRule(code: string): Promise<PromoCodeRule | null> {
    const row = await this.prisma.db.promoCode.findUnique({
      where: { code: normalizePromoCode(code) },
    });
    return row ? this.toRule(row) : null;
  }

  /** Demande au site les remises qu'il gère encore. Panne ⇒ zéro remise. */
  private async remiseSite(input: {
    lines: RemiseLine[];
    zone: string;
    mode: 'domicile' | 'retrait';
    codePromo?: string;
    phone?: string;
  }): Promise<SiteRemise> {
    const result = await this.pricing.remise({
      items: input.lines.map((line) => ({
        sourceRef: line.sourceRef,
        quantity: line.quantity,
      })),
      zone: input.zone,
      mode: input.mode,
      codePromo: input.codePromo,
      phone: input.phone,
    });
    return result.status === 'ok'
      ? {
          status: 'ok',
          remise: result.remise,
          code: result.code,
          message: result.message,
        }
      : { status: 'unavailable' };
  }

  private toRule(row: {
    code: string;
    description: string | null;
    discountType: 'PERCENT' | 'FIXED';
    discountValue: number;
    minOrderTotal: number | null;
    appliesTo: string[];
    zone: string | null;
    maxUses: number | null;
    usedCount: number;
    maxUsesPerPhone: number | null;
    startsAt: Date;
    endsAt: Date | null;
    isActive: boolean;
  }): PromoCodeRule {
    return {
      code: row.code,
      description: row.description,
      discountType: row.discountType,
      discountValue: row.discountValue,
      minOrderTotal: row.minOrderTotal,
      appliesTo: row.appliesTo,
      zone: row.zone,
      maxUses: row.maxUses,
      usedCount: row.usedCount,
      maxUsesPerPhone: row.maxUsesPerPhone,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      isActive: row.isActive,
    };
  }

  /** Refuse à l'écriture ce qui produirait une remise absurde. */
  private assertValues(
    dto: { discountType: string; discountValue: number },
    code: string,
  ): void {
    if (code.length < 3) {
      throw new ConflictException({
        code: 'PROMO_CODE_TOO_SHORT',
        message: 'Le code doit contenir au moins 3 caractères.',
      });
    }
    if (!Number.isInteger(dto.discountValue) || dto.discountValue <= 0) {
      throw new ConflictException({
        code: 'PROMO_VALUE_INVALID',
        message: 'La valeur de la remise doit être un entier positif.',
      });
    }
    if (dto.discountType === 'PERCENT' && dto.discountValue > 100) {
      throw new ConflictException({
        code: 'PROMO_VALUE_INVALID',
        message: 'Un pourcentage ne peut pas dépasser 100 %.',
      });
    }
  }
}

/** `07 00 00 00 01` → `07******01` : un suivi d'usage n'est pas un annuaire. */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 2)}${'*'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-2)}`;
}
