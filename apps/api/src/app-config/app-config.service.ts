import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COMPANY,
  type AppConfig,
  type DeliveryInfo,
  type FaqEntry,
  type PointOfSale,
  type SupportContact,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type {
  UpsertPointOfSaleDto,
  UpdateSupportDto,
} from './dto/app-config.dto';

/**
 * Configuration commerciale servie à l'application.
 *
 * Pourquoi ce service existe : le numéro du service client, les points de
 * vente et les textes de livraison étaient dans le bundle livré sur le Play
 * Store. Changer un numéro exigeait donc une nouvelle version, une revue, et
 * une mise à jour chez tous les clients — pour une ligne de texte.
 *
 * Ils vivent maintenant en base, modifiables depuis l'administration, et sont
 * servis par `GET /config/app`. Les valeurs de `company.ts` ne servent plus que
 * de REPLI quand l'API n'est pas joignable : l'écran affiche quelque chose de
 * juste plutôt qu'un écran vide, et la source reste le serveur.
 *
 * Rien n'est inventé ici : les points de vente sont saisis par AGRIM, et la
 * liste est VIDE tant qu'aucun n'a été publié.
 */
@Injectable()
export class AppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Ce que l'application affiche : contact, points de vente, livraison, FAQ. */
  async publicConfig(): Promise<AppConfig> {
    const [settings, points] = await Promise.all([
      this.readSettings(),
      this.prisma.db.pointOfSale.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          landmark: true,
          phone: true,
          openingHours: true,
          latitude: true,
          longitude: true,
          supportsPickup: true,
          isActive: true,
          sortOrder: true,
        },
      }),
    ]);

    return {
      version: 1,
      // Le repli vient de la configuration AGRIM du contrat partagé : jamais
      // d'une chaîne écrite directement dans un écran.
      support: {
        phone: settings.support?.phone ?? COMPANY.phone,
        landlinePhone: settings.support?.landlinePhone ?? COMPANY.landlinePhone,
        whatsapp: settings.support?.whatsapp ?? null,
        email: settings.support?.email ?? null,
      },
      pointsOfSale: points as PointOfSale[],
      delivery: settings.delivery ?? DEFAULT_DELIVERY,
      faq: settings.faq ?? [],
      // L'état du push vient de la configuration du SERVEUR, pas d'une
      // supposition de l'application : elle ne demandera pas la permission de
      // notifier si rien ne peut être envoyé.
      push: {
        enabled: this.config.get<string>('PUSH_ENABLED') === 'true',
      },
      announcement: settings.announcement ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  /* ─────────────────────────── Administration ─────────────────────────── */

  async listPointsOfSale() {
    return this.prisma.db.pointOfSale.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Création ou mise à jour d'un point de vente.
   *
   * Les points de vente sont une INFORMATION COMMERCIALE : AGRIM peut publier
   * l'adresse d'une boutique sans qu'elle soit ouverte au retrait dans
   * l'application (`supportsPickup: false`). Les deux notions ne se mélangent
   * pas — promettre un retrait qui n'existe pas ferait déplacer un client pour
   * rien.
   */
  async upsertPointOfSale(dto: UpsertPointOfSaleDto, id?: string) {
    const data = {
      name: dto.name.trim(),
      address: dto.address.trim(),
      city: dto.city.trim(),
      landmark: dto.landmark?.trim() || null,
      phone: dto.phone?.trim() || null,
      openingHours: dto.openingHours?.trim() || null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      supportsPickup: dto.supportsPickup ?? true,
      isActive: dto.isActive ?? false,
      sortOrder: dto.sortOrder ?? 0,
    };

    if (data.latitude !== null && (data.latitude < -90 || data.latitude > 90)) {
      throw new BadRequestException({
        code: 'COORDINATES_INVALID',
        message: 'Latitude invalide.',
      });
    }
    if (
      data.longitude !== null &&
      (data.longitude < -180 || data.longitude > 180)
    ) {
      throw new BadRequestException({
        code: 'COORDINATES_INVALID',
        message: 'Longitude invalide.',
      });
    }

    if (id) {
      await this.prisma.db.pointOfSale.update({ where: { id }, data });
    } else {
      await this.prisma.db.pointOfSale.create({ data });
    }
    return this.listPointsOfSale();
  }

  /** Désactivation : un point de vente ne se supprime pas (historique). */
  async deactivatePointOfSale(id: string) {
    await this.prisma.db.pointOfSale.update({
      where: { id },
      data: { isActive: false },
    });
    return this.listPointsOfSale();
  }

  async updateSupport(dto: UpdateSupportDto) {
    // `Partial<SupportContact>` : les coordonnées publiées peuvent être
    // partielles (un numéro mobile seul, sans fixe ni e-mail).
    const current: Partial<SupportContact> =
      (await this.readSettings()).support ?? {};
    const support: SupportContact = {
      phone: dto.phone?.trim() || current.phone || null,
      landlinePhone: dto.landlinePhone?.trim() || current.landlinePhone || null,
      whatsapp: dto.whatsapp?.trim() || current.whatsapp || null,
      email: dto.email?.trim() || current.email || null,
    };
    await this.writeSetting('appSupport', support);
    return support;
  }

  async updateDelivery(dto: DeliveryInfo) {
    const delivery: DeliveryInfo = {
      summary: dto.summary.trim(),
      delays: dto.delays.trim(),
      pickupConditions: dto.pickupConditions.trim(),
      feeNotice: dto.feeNotice.trim(),
    };
    await this.writeSetting('appDelivery', delivery);
    return delivery;
  }

  async updateFaq(entries: FaqEntry[]) {
    const faq = entries.map((entry) => ({
      question: entry.question.trim(),
      answer: entry.answer.trim(),
    }));
    await this.writeSetting('appFaq', faq);
    return faq;
  }

  async updateAnnouncement(message: string | null) {
    await this.writeSetting('appAnnouncement', message?.trim() || null);
    return { announcement: message?.trim() || null };
  }

  /* ───────────────────────────── Interne ─────────────────────────────── */

  private async readSettings(): Promise<{
    support?: SupportContact;
    delivery?: DeliveryInfo;
    faq?: FaqEntry[];
    announcement?: string | null;
  }> {
    const rows = await this.prisma.db.companySetting.findMany({
      where: {
        key: {
          in: [
            'appSupport',
            'appDelivery',
            'appFaq',
            'appAnnouncement',
          ],
        },
      },
      select: { key: true, value: true },
    });

    const parCle = new Map(rows.map((row) => [row.key, row.value]));
    const lire = <T>(cle: string): T | undefined => {
      const brut = parCle.get(cle);
      if (!brut) return undefined;
      try {
        return JSON.parse(brut) as T;
      } catch {
        // Une valeur corrompue ne doit pas priver le client de tout l'écran :
        // on retombe sur les valeurs par défaut, jamais sur un écran vide.
        return undefined;
      }
    };

    return {
      support: lire<SupportContact>('appSupport'),
      delivery: lire<DeliveryInfo>('appDelivery'),
      faq: lire<FaqEntry[]>('appFaq'),
      announcement: parCle.has('appAnnouncement')
        ? lire<string | null>('appAnnouncement')
        : undefined,
    };
  }

  private async writeSetting(key: string, value: unknown): Promise<void> {
    const serialise = JSON.stringify(value ?? null);
    await this.prisma.db.companySetting.upsert({
      where: { key },
      create: { key, value: serialise },
      update: { value: serialise },
    });
  }
}

/**
 * Textes de livraison par défaut.
 *
 * Ils décrivent ce que le système fait RÉELLEMENT : aucune promesse de délai
 * chiffré, aucune zone inventée, et la mention obligatoire que les frais ne
 * sont pas encaissés en ligne. AGRIM peut les remplacer depuis
 * l'administration.
 */
const DEFAULT_DELIVERY: DeliveryInfo = {
  summary:
    'Livraison à domicile ou retrait au point de vente. Les frais de livraison sont confirmés par AGRIM avant l’expédition.',
  delays: 'Le délai est annoncé par AGRIM lors de la confirmation de la commande.',
  pickupConditions:
    'Présentez votre numéro de commande au point de vente choisi. Le retrait n’est ouvert que si le point l’indique.',
  feeNotice:
    'Aucun frais n’est payé en ligne : le règlement se fait à la livraison ou par transfert direct vers le numéro officiel d’AGRIM.',
};
