import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  PAYMENT_DECLARATION_LIMITS,
  amountMatches,
  buildPaymentInstructionsText,
  type DirectPaymentMethod,
  type PaymentInstruction,
  type PaymentStatus,
} from '@agrim/contracts';

import { kickOutboxDrain } from '../jobs/outbox-drain';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  type StorageUpload,
} from '../storage/storage.provider';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { DeclarePaymentDto, ReviewPaymentDto } from './dto/direct-payment.dto';

/** Propriétaire d'une commande : un compte, ou une commande invitée. */
export type PaymentOwner = { userId: string } | { guest: true };

/** Ce que l'administration voit d'une déclaration en attente. */
export interface PendingDeclarationView {
  declarationId: string;
  orderReference: string;
  customerName: string;
  customerPhone: string;
  expectedAmount: number;
  declaredAmount: number;
  paymentMethodCode: string | null;
  receivingNumber: string | null;
  transactionReference: string;
  declaredPaidAt: string | null;
  submittedAt: string;
  hasProof: boolean;
  /** Type MIME du justificatif : l'écran ne prévisualise que les images. */
  proofMimeType: string | null;
  status: string;
  amountMatches: boolean;
  orderStatus: string;
  paymentStatus: PaymentStatus;
  /** Dernière décision connue sur ce paiement, pour l'historique. */
  lastReview: {
    action: string;
    note: string | null;
    actorName: string | null;
    createdAt: string;
  } | null;
}

/**
 * PAIEMENT DIRECT MANUEL — le cœur de la décision commerciale du 11 octobre 2026.
 *
 * Ce service remplace l'encaissement par agrégateur pour les NOUVELLES
 * commandes. Le client transfère vers le numéro officiel d'AGRIM, déclare sa
 * transaction, et un responsable constate la réception réelle des fonds.
 *
 * Trois vérités à ne jamais perdre de vue :
 *
 *  1. **Rien n'est automatique.** `SUCCEEDED` s'obtient par une seule voie :
 *     `review()` appelée par un membre authentifié du personnel. Il n'existe
 *     aucun chemin — aucune route, aucun webhook, aucun délai — qui confirme
 *     un paiement tout seul.
 *  2. **Une déclaration n'est pas une preuve.** Le justificatif est un indice
 *     contrôlé (type, taille), conservé pour la vérification humaine, jamais
 *     interprété comme un encaissement.
 *  3. **Le montant attendu est figé.** Il vient de la commande, pas du client ;
 *     un écart déclenche une vérification manuelle, jamais un ajustement
 *     silencieux.
 *
 * Note sur la réconciliation : `PaymentsService.reconcilePending` ne balaie
 * que `AWAITING_CONFIRMATION` (régime agrégateur). Un paiement manuel
 * n'expire donc JAMAIS tout seul — le client qui revient trois jours plus tard
 * retrouve sa commande intacte, ce que le brief exige explicitement.
 */
@Injectable()
export class DirectPaymentsService {
  private readonly logger = new Logger(DirectPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /* ─────────────────────── Lecture : le client ─────────────────────────── */

  /**
   * Charge l'instruction de paiement d'une commande.
   *
   * Le propriétaire est vérifié ICI : identifiant de compte, ou commande
   * invitée (le contrôleur a déjà validé la capacité temporaire).
   */
  async instructions(
    reference: string,
    owner: PaymentOwner,
  ): Promise<PaymentInstruction> {
    const order = await this.loadOrder(reference, owner);
    const payment = order.payment;
    if (!payment) throw this.notFound();
    if (payment.method !== 'DIRECT_MOBILE_MONEY') {
      // Les commandes réglées par agrégateur ou à la livraison n'ont pas
      // d'instruction de transfert : le dire clairement vaut mieux que servir
      // un numéro qui n'a rien à voir avec cette commande.
      throw new BadRequestException({
        code: 'PAYMENT_NOT_DIRECT',
        message:
          payment.method === 'CASH_ON_DELIVERY'
            ? 'Cette commande se règle à la livraison.'
            : 'Cette commande ne se règle pas par transfert direct.',
      });
    }

    const method = await this.resolveMethod(payment.methodCode);
    const last = payment.declarations[0] ?? null;

    return {
      reference: order.reference,
      amount: payment.amount,
      currency: 'XOF',
      status: payment.status as PaymentStatus,
      method,
      paymentReference: order.reference,
      // Le motif du dernier rejet est RENDU AU CLIENT : sans lui, il ne peut
      // pas corriger sa déclaration ni comprendre ce qu'AGRIM attend.
      rejectionNote:
        payment.status === 'REJECTED' ? (payment.failureReason ?? null) : null,
      declarations: payment.declarations.length,
      lastDeclaration: last
        ? {
            transactionReference: last.transactionReference,
            declaredAmount: last.declaredAmount,
            submittedAt: last.submittedAt.toISOString(),
            status: payment.status as PaymentStatus,
          }
        : null,
    };
  }

  /** Texte prêt à copier (numéro + montant + référence). */
  async instructionsText(reference: string, owner: PaymentOwner) {
    const view = await this.instructions(reference, owner);
    return {
      reference: view.reference,
      text: buildPaymentInstructionsText({
        method: view.method,
        amount: view.amount,
        reference: view.paymentReference,
      }),
    };
  }

  /* ───────────────────── Déclaration : le client ───────────────────────── */

  /**
   * Enregistre une déclaration de transfert.
   *
   * Effets, dans une seule transaction :
   *  - une ligne `PaymentDeclaration` (référence unique, montant annoncé) ;
   *  - le statut du paiement passe à `DECLARED_BY_CUSTOMER`
   *    (ou `UNDER_REVIEW` si le montant annoncé diffère de l'attendu) ;
   *  - une ligne de journal.
   *
   * Le personnel est prévenu ensuite, hors transaction : une notification qui
   * échoue ne doit pas annuler une déclaration.
   */
  async declare(input: {
    reference: string;
    owner: PaymentOwner;
    dto: DeclarePaymentDto;
    proof?: StorageUpload;
    actorIp?: string;
  }) {
    const order = await this.loadOrder(input.reference, input.owner);
    const payment = order.payment;
    if (!payment) throw this.notFound();

    if (payment.method !== 'DIRECT_MOBILE_MONEY') {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_DIRECT',
        message: 'Cette commande ne se règle pas par transfert direct.',
      });
    }
    if (order.status === 'CANCELLED') {
      throw new ConflictException({
        code: 'ORDER_CANCELLED',
        message: 'Cette commande a été annulée.',
      });
    }
    if (payment.status === 'SUCCEEDED') {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_CONFIRMED',
        message: 'Le paiement de cette commande est déjà confirmé.',
      });
    }
    if (payment.declarations.length >= PAYMENT_DECLARATION_LIMITS.maxPerOrder) {
      throw new ConflictException({
        code: 'PAYMENT_DECLARATION_LIMIT',
        message:
          'Trop de déclarations ont déjà été déposées sur cette commande. Contactez AGRIM.',
      });
    }

    const reference = input.dto.transactionReference
      .trim()
      .replace(/\s+/g, '');
    const normalized = reference.toUpperCase();

    // Un justificatif est contrôlé AVANT d'être écrit : accepter n'importe
    // quel fichier puis le trier après coup reviendrait à le stocker quand même.
    const proof = input.proof ? await this.storeProof(input.proof) : null;

    const mismatch = !amountMatches(input.dto.declaredAmount, payment.amount);
    const nextStatus: PaymentStatus = mismatch
      ? 'UNDER_REVIEW'
      : 'DECLARED_BY_CUSTOMER';

    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.paymentDeclaration.create({
          data: {
            paymentId: payment.id,
            transactionReference: reference,
            transactionReferenceNormalized: normalized,
            declaredAmount: input.dto.declaredAmount,
            paidAt: input.dto.paidAt ? new Date(input.dto.paidAt) : null,
            proofKey: proof?.key ?? null,
            proofMimeType: proof?.mimeType ?? null,
            proofSizeBytes: proof?.sizeBytes ?? null,
            status: 'DECLARED',
          },
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: nextStatus,
            // Un écart de montant n'est PAS une confirmation partielle : il
            // ouvre un arbitrage humain, et le dit dans le journal.
            failureReason: null,
          },
        });

        await tx.paymentReviewLog.create({
          data: {
            paymentId: payment.id,
            action: mismatch ? 'AMOUNT_MISMATCH' : 'DECLARED',
            fromStatus: payment.status,
            toStatus: nextStatus,
            note: input.dto.note?.slice(0, 500) ?? null,
            actorSource: 'CLIENT',
            actorIp: input.actorIp?.slice(0, 60) ?? null,
          },
        });
      });
    } catch (error) {
      // Référence déjà utilisée : soit le client a rejoué son envoi (réseau
      // coupé), soit quelqu'un essaie de faire valider deux fois le même
      // transfert. Dans les deux cas on refuse, avec un message utilisable.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException({
          code: 'PAYMENT_REFERENCE_ALREADY_USED',
          message:
            'Cette référence de transaction a déjà été enregistrée. Vérifiez-la, ou contactez AGRIM.',
        });
      }
      throw error;
    }

    // Prévenir l'équipe : hors transaction, sans bloquer la réponse client.
    void this.notifications
      .notifyStaff({
        type: mismatch ? 'PAYMENT_AMOUNT_MISMATCH' : 'PAYMENT_DECLARED',
        reference: order.reference,
        orderId: order.id,
      })
      .catch(() => undefined);

    // Accuser réception AUPRÈS DU CLIENT aussi : sans ce message, il ne sait
    // pas si son geste a été enregistré.
    void this.notifyCustomer({
      reference: order.reference,
      orderId: order.id,
      userId: order.guestPhone ? null : order.userId,
      phone: order.guestPhone ?? order.phone,
      type: mismatch ? 'PAYMENT_AMOUNT_MISMATCH' : 'PAYMENT_DECLARED',
    }).catch(() => undefined);

    return {
      recorded: true,
      status: nextStatus,
      amountMatches: !mismatch,
      message: mismatch
        ? 'Votre déclaration est enregistrée. Le montant annoncé diffère du montant attendu : AGRIM vous contacte.'
        : 'Merci. Votre déclaration est enregistrée : AGRIM vérifie la réception des fonds.',
    };
  }

  /* ────────────────────── Vérification : le personnel ──────────────────── */

  /** File d'attente des déclarations à vérifier. */
  async listDeclarations(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
    type DeclarationStatus = 'DECLARED' | 'VERIFYING' | 'ACCEPTED' | 'REJECTED';
    const known: DeclarationStatus[] = [
      'DECLARED',
      'VERIFYING',
      'ACCEPTED',
      'REJECTED',
    ];
    const status = known.includes(filters.status as DeclarationStatus)
      ? (filters.status as DeclarationStatus)
      : { in: ['DECLARED', 'VERIFYING'] as DeclarationStatus[] };

    const search = filters.search?.trim();

    const [rows, total] = await Promise.all([
      this.prisma.db.paymentDeclaration.findMany({
        where: {
          status,
          ...(search
            ? {
                payment: {
                  order: {
                    OR: [
                      { reference: { contains: search, mode: 'insensitive' } },
                      { guestPhone: { contains: search } },
                      { guestName: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              }
            : {}),
        },
        orderBy: { submittedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          transactionReference: true,
          declaredAmount: true,
          paidAt: true,
          submittedAt: true,
          status: true,
          proofKey: true,
          proofMimeType: true,
          payment: {
            select: {
              amount: true,
              status: true,
              methodCode: true,
              receivingNumber: true,
              reviews: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  action: true,
                  note: true,
                  createdAt: true,
                  actor: { select: { firstName: true, lastName: true } },
                },
              },
              order: {
                select: {
                  id: true,
                  reference: true,
                  status: true,
                  guestName: true,
                  guestPhone: true,
                  userId: true,
                  user: {
                    select: { firstName: true, lastName: true, phone: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.db.paymentDeclaration.count({
        where: {
          status,
          ...(search
            ? {
                payment: {
                  order: {
                    OR: [
                      { reference: { contains: search, mode: 'insensitive' } },
                      { guestPhone: { contains: search } },
                    ],
                  },
                },
              }
            : {}),
        },
      }),
    ]);

    const data: PendingDeclarationView[] = rows.map((row) => {
      const order = row.payment.order;
      const last = row.payment.reviews[0] ?? null;
      return {
        declarationId: row.id,
        orderReference: order.reference,
        customerName:
          order.guestName ??
          `${order.user?.firstName ?? ''} ${order.user?.lastName ?? ''}`.trim(),
        customerPhone: order.guestPhone ?? order.user?.phone ?? '',
        expectedAmount: row.payment.amount,
        declaredAmount: row.declaredAmount,
        paymentMethodCode: row.payment.methodCode,
        receivingNumber: row.payment.receivingNumber,
        transactionReference: row.transactionReference,
        declaredPaidAt: row.paidAt ? row.paidAt.toISOString() : null,
        submittedAt: row.submittedAt.toISOString(),
        hasProof: row.proofKey !== null,
        proofMimeType: row.proofKey !== null ? row.proofMimeType : null,
        status: row.status,
        amountMatches: amountMatches(row.declaredAmount, row.payment.amount),
        orderStatus: order.status,
        paymentStatus: row.payment.status as PaymentStatus,
        lastReview: last
          ? {
              action: last.action,
              note: last.note,
              actorName: last.actor
                ? `${last.actor.firstName} ${last.actor.lastName}`.trim()
                : null,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
      };
    });

    return { data, meta: { page, limit, total } };
  }

  /** Détail complet d'un dossier de paiement (avant décision). */
  async declarationDetail(declarationId: string) {
    const row = await this.prisma.db.paymentDeclaration.findUnique({
      where: { id: declarationId },
      select: {
        id: true,
        transactionReference: true,
        declaredAmount: true,
        paidAt: true,
        submittedAt: true,
        status: true,
        proofKey: true,
        proofMimeType: true,
        proofSizeBytes: true,
        rejectionNote: true,
        payment: {
          select: {
            id: true,
            amount: true,
            status: true,
            methodCode: true,
            receivingNumber: true,
            confirmedAt: true,
            order: {
              select: {
                id: true,
                reference: true,
                status: true,
                total: true,
                guestName: true,
                guestPhone: true,
                createdAt: true,
                user: { select: { firstName: true, lastName: true, phone: true } },
                items: {
                  select: {
                    productName: true,
                    variantLabel: true,
                    quantity: true,
                    lineTotal: true,
                  },
                },
              },
            },
            reviews: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                action: true,
                fromStatus: true,
                toStatus: true,
                note: true,
                actorSource: true,
                actorIp: true,
                createdAt: true,
                actor: { select: { firstName: true, lastName: true, role: true } },
              },
            },
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException({
        code: 'PAYMENT_DECLARATION_NOT_FOUND',
        message: 'Cette déclaration de paiement est introuvable.',
      });
    }
    return row;
  }

  /**
   * Décision d'un vérificateur : confirmer, rejeter, ou maintenir en examen.
   *
   * La confirmation est une **bascule conditionnelle** : la mise à jour ne
   * s'applique que si le paiement n'est pas déjà réglé. Deux vérificateurs qui
   * cliquent en même temps ne peuvent donc pas régler deux fois — le second
   * obtient `count === 0` et reçoit un message explicite.
   */
  async review(
    declarationId: string,
    dto: ReviewPaymentDto,
    staff: AuthenticatedUser,
    actorIp?: string,
  ) {
    const declaration = await this.prisma.db.paymentDeclaration.findUnique({
      where: { id: declarationId },
      select: {
        id: true,
        paymentId: true,
        declaredAmount: true,
        transactionReference: true,
        payment: {
          select: {
            id: true,
            amount: true,
            status: true,
            order: {
              select: {
                id: true,
                reference: true,
                userId: true,
                status: true,
                guestPhone: true,
                total: true,
                items: { select: { variantId: true, quantity: true } },
                user: { select: { phone: true } },
              },
            },
          },
        },
      },
    });

    if (!declaration) {
      throw new NotFoundException({
        code: 'PAYMENT_DECLARATION_NOT_FOUND',
        message: 'Cette déclaration de paiement est introuvable.',
      });
    }

    const payment = declaration.payment;
    const order = payment.order;

    if (dto.decision === 'REVIEW') {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.paymentDeclaration.update({
          where: { id: declarationId },
          data: { status: 'VERIFYING', reviewedById: staff.id, reviewedAt: new Date() },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'UNDER_REVIEW' },
        });
        await tx.paymentReviewLog.create({
          data: {
            paymentId: payment.id,
            action: 'VERIFYING',
            fromStatus: payment.status,
            toStatus: 'UNDER_REVIEW',
            note: dto.note?.slice(0, 500) ?? null,
            actorId: staff.id,
            actorRole: staff.role,
            actorSource: 'STAFF',
            actorIp: actorIp?.slice(0, 60) ?? null,
          },
        });
      });
      return { status: 'UNDER_REVIEW' as const };
    }

    if (dto.decision === 'REJECT') {
      // Un rejet SANS motif laisserait le client sans recours : il a payé, il
      // ne comprend pas, et personne ne peut lui expliquer. Le motif est donc
      // exigé, et c'est lui qui part au client.
      const note = dto.rejectionNote?.trim() || dto.note?.trim();
      if (!note) {
        throw new BadRequestException({
          code: 'REJECTION_NOTE_REQUIRED',
          message: 'Indiquez le motif du rejet : le client le recevra.',
        });
      }

      const claimed = await this.prisma.db.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: payment.id, status: { notIn: ['SUCCEEDED', 'REFUNDED'] } },
          data: { status: 'REJECTED', failureReason: note.slice(0, 255) },
        });
        if (updated.count === 0) return false;

        await tx.paymentDeclaration.update({
          where: { id: declarationId },
          data: {
            status: 'REJECTED',
            rejectionNote: note.slice(0, 300),
            reviewedById: staff.id,
            reviewedAt: new Date(),
          },
        });
        await tx.paymentReviewLog.create({
          data: {
            paymentId: payment.id,
            action: 'REJECTED',
            fromStatus: payment.status,
            toStatus: 'REJECTED',
            note: note.slice(0, 500),
            actorId: staff.id,
            actorRole: staff.role,
            actorSource: 'STAFF',
            actorIp: actorIp?.slice(0, 60) ?? null,
          },
        });
        return true;
      });

      if (!claimed) {
        throw new ConflictException({
          code: 'PAYMENT_ALREADY_SETTLED',
          message: 'Ce paiement a déjà été réglé : le rejet n’a pas été appliqué.',
        });
      }

      // La commande n'est PAS annulée : « montant incorrect » ou « référence
      // invalide » n'est pas une décision d'annulation. AGRIM garde la main.
      void this.notifyCustomer({
        reference: order.reference,
        orderId: order.id,
        userId: order.guestPhone ? null : order.userId,
        phone: order.guestPhone ?? order.user?.phone ?? null,
        type: 'PAYMENT_REJECTED',
      }).catch(() => undefined);

      return { status: 'REJECTED' as const, note };
    }

    /* ── CONFIRM ────────────────────────────────────────────────────────── */

    const claimed = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: { id: payment.id, status: { notIn: ['SUCCEEDED', 'REFUNDED'] } },
        data: { status: 'SUCCEEDED', paidAt: new Date(), confirmedAt: new Date() },
      });
      if (updated.count === 0) return false;

      await tx.paymentDeclaration.update({
        where: { id: declarationId },
        data: { status: 'ACCEPTED', reviewedById: staff.id, reviewedAt: new Date() },
      });
      await tx.paymentReviewLog.create({
        data: {
          paymentId: payment.id,
          action: 'CONFIRMED',
          fromStatus: payment.status,
          toStatus: 'SUCCEEDED',
          note:
            dto.note?.slice(0, 500) ??
            `Réception vérifiée (réf. ${declaration.transactionReference}).`,
          actorId: staff.id,
          actorRole: staff.role,
          actorSource: 'STAFF',
          actorIp: actorIp?.slice(0, 60) ?? null,
        },
      });

      // La commande passe à CONFIRMED : c'est la même transition que celle que
      // produisait un paiement d'agrégateur réussi, donc aucun écran à adapter.
      if (order.status === 'PENDING') {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CONFIRMED' },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            status: 'CONFIRMED',
            actorId: staff.id,
            comment: 'Paiement vérifié par AGRIM.',
          },
        });
      } else {
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            status: order.status,
            actorId: staff.id,
            comment: 'Paiement vérifié par AGRIM.',
          },
        });
      }

      // Les événements naissent DANS la transaction : un paiement confirmé
      // sans son événement n'existe pas. `PAYMENT_SUCCEEDED` est l'angle
      // système (audit) ; les autres portent la diffusion client.
      if (!order.guestPhone) {
        for (const type of [
          'PAYMENT_SUCCEEDED',
          'PAYMENT_CONFIRMED',
          'ORDER_CONFIRMED',
        ] as const) {
          await tx.outboxEvent.create({
            data: {
              type,
              payload: {
                userId: order.userId,
                orderId: order.id,
                reference: order.reference,
                total: order.total,
              },
            },
          });
        }
      }

      return true;
    });

    if (!claimed) {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_SETTLED',
        message:
          'Ce paiement a déjà été réglé (par vous ou par un collègue) : rien n’a été appliqué deux fois.',
      });
    }

    // Une commande invitée n'a pas d'outbox : on pousse directement sur ses
    // appareils, rattachés par le numéro de téléphone.
    if (order.guestPhone) {
      void this.notifyCustomer({
        reference: order.reference,
        orderId: order.id,
        userId: null,
        phone: order.guestPhone,
        type: 'PAYMENT_CONFIRMED',
      }).catch(() => undefined);
    }

    kickOutboxDrain();
    this.logger.log(
      `Paiement confirmé : ${order.reference} (réf. ${declaration.transactionReference}) par ${staff.role}.`,
    );

    return { status: 'SUCCEEDED' as const, orderReference: order.reference };
  }

  /** Historique horodaté d'un paiement — qui a fait quoi, et quand. */
  async historyForReference(reference: string) {
    const payment = await this.prisma.db.payment.findFirst({
      where: { order: { reference } },
      select: {
        id: true,
        amount: true,
        status: true,
        methodCode: true,
        receivingNumber: true,
        confirmedAt: true,
        order: { select: { reference: true, status: true } },
        declarations: {
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            transactionReference: true,
            declaredAmount: true,
            status: true,
            submittedAt: true,
            reviewedAt: true,
            rejectionNote: true,
            proofKey: true,
            reviewedBy: { select: { firstName: true, lastName: true, role: true } },
          },
        },
        reviews: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            action: true,
            fromStatus: true,
            toStatus: true,
            note: true,
            actorSource: true,
            actorIp: true,
            createdAt: true,
            actor: { select: { firstName: true, lastName: true, role: true } },
          },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Aucun paiement pour cette commande.',
      });
    }
    return payment;
  }

  /** Justificatif : jamais servi sans contrôle d'accès (route personnel). */
  async proof(declarationId: string) {
    const declaration = await this.prisma.db.paymentDeclaration.findUnique({
      where: { id: declarationId },
      select: { proofKey: true, proofMimeType: true, proofSizeBytes: true },
    });
    if (!declaration?.proofKey) {
      throw new NotFoundException({
        code: 'PAYMENT_PROOF_NOT_FOUND',
        message: 'Aucun justificatif pour cette déclaration.',
      });
    }
    const buffer = await this.storage.read(declaration.proofKey);
    if (!buffer) {
      throw new NotFoundException({
        code: 'PAYMENT_PROOF_NOT_FOUND',
        message: 'Le justificatif n’est plus disponible.',
      });
    }
    return {
      buffer,
      mimeType: declaration.proofMimeType ?? 'application/octet-stream',
      sizeBytes: declaration.proofSizeBytes ?? buffer.byteLength,
    };
  }

  /* ───────────────────────────── Interne ─────────────────────────────── */

  private async loadOrder(reference: string, owner: PaymentOwner) {
    const order = await this.prisma.db.order.findFirst({
      where:
        'userId' in owner
          ? { reference, userId: owner.userId }
          : { reference, guestPhone: { not: null } },
      select: {
        id: true,
        reference: true,
        userId: true,
        status: true,
        guestPhone: true,
        user: { select: { phone: true } },
        payment: {
          select: {
            id: true,
            method: true,
            methodCode: true,
            amount: true,
            status: true,
            failureReason: true,
            declarations: {
              orderBy: { submittedAt: 'desc' },
              select: {
                transactionReference: true,
                declaredAmount: true,
                submittedAt: true,
              },
            },
          },
        },
      },
    });
    if (!order) throw this.notFound();
    return { ...order, phone: order.user.phone };
  }

  /**
   * Le moyen de paiement tel qu'il était au moment de la commande.
   *
   * Si AGRIM l'a désactivé depuis, on affiche quand même SA configuration
   * d'alors : le client a peut-être déjà payé sur ce numéro. On préfère un
   * numéro retiré mais exact à un message d'erreur qui laisse l'argent en
   * suspens — et l'écran précise que la commande est en vérification.
   */
  private async resolveMethod(
    code: string | null,
  ): Promise<DirectPaymentMethod> {
    const row = code
      ? await this.prisma.db.paymentMethodConfig.findUnique({
          where: { code },
          select: {
            code: true,
            operatorName: true,
            receivingNumber: true,
            beneficiaryName: true,
            instructions: true,
            ussdTemplate: true,
            qrPayload: true,
            paymentUrl: true,
            isActive: true,
          },
        })
      : null;

    if (row) {
      return {
        code: row.code,
        operatorName: row.operatorName,
        receivingNumber: row.receivingNumber,
        beneficiaryName: row.beneficiaryName,
        instructions: row.instructions,
        ussdTemplate: row.ussdTemplate,
        qrPayload: row.qrPayload,
        paymentUrl: row.paymentUrl,
      };
    }

    // Aucun numéro configuré : on ne fabrique RIEN. L'application affiche le
    // message d'indisponibilité et invite à choisir un autre moyen — un numéro
    // inventé enverrait l'argent du client à un inconnu.
    throw new ServiceUnavailableException({
      code: 'PAYMENT_METHOD_NOT_CONFIGURED',
      message:
        'Le paiement par transfert direct n’est pas encore configuré. Choisissez le paiement à la livraison, ou contactez AGRIM.',
    });
  }

  /** Contrôle le justificatif puis le dépose. Refuse plutôt que de stocker. */
  private async storeProof(file: StorageUpload) {
    if (
      !(PAYMENT_DECLARATION_LIMITS.proofMimeTypes as readonly string[]).includes(
        file.mimeType,
      )
    ) {
      throw new BadRequestException({
        code: 'PAYMENT_PROOF_TYPE_INVALID',
        message: 'Le justificatif doit être une image (JPEG, PNG, WebP) ou un PDF.',
      });
    }
    if (file.buffer.byteLength > PAYMENT_DECLARATION_LIMITS.proofMaxBytes) {
      throw new BadRequestException({
        code: 'PAYMENT_PROOF_TOO_LARGE',
        message: 'Le justificatif dépasse 5 Mo.',
      });
    }
    return this.storage.put('payment-proofs', file);
  }

  /**
   * Prévient le client, qu'il ait un compte ou non.
   *
   * Compte : le canal habituel (notification en base + push). Invité : push
   * direct sur les appareils rattachés à son numéro — c'est la seule façon de
   * le joindre, et c'est précisément pour cela que `PushDevice` existe.
   */
  private async notifyCustomer(input: {
    reference: string;
    orderId: string;
    userId: string | null;
    phone: string | null;
    type: Parameters<NotificationsService['notify']>[0]['type'];
  }): Promise<void> {
    if (input.userId) {
      await this.notifications.notify({
        userId: input.userId,
        type: input.type,
        reference: input.reference,
        orderId: input.orderId,
      });
      return;
    }
    if (input.phone) {
      await this.notifications.notifyPhone({
        phone: input.phone,
        type: input.type,
        reference: input.reference,
        orderId: input.orderId,
      });
    }
  }

  /** Même réponse pour « inexistante » et « pas la vôtre » : pas d'énumération. */
  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'PAYMENT_NOT_FOUND',
      message: 'Aucun paiement pour cette commande.',
    });
  }
}
