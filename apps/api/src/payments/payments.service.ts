/**
 * Orchestration du paiement d'une commande.
 *
 * Le pilote (CinetPay, PayDunya, simulation) ne connaît que le protocole de
 * son agrégateur. Tout ce qui touche à la commande, au stock et aux
 * notifications vit ici.
 *
 * Deux invariants gouvernent ce fichier :
 *
 *  1. **Un webhook n'est pas une preuve.** Un succès annoncé par un appel
 *     entrant est reconfirmé auprès de l'API du fournisseur avant d'être
 *     inscrit en base. Sans cela, n'importe qui connaissant une référence de
 *     transaction peut faire passer une commande en « payée ».
 *
 *  2. **Le règlement est idempotent.** Un opérateur rejoue ses webhooks quand
 *     il n'obtient pas de 200 assez vite. Régler deux fois rendrait le stock
 *     deux fois et enverrait deux notifications.
 */
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  PaymentGatewayError,
  PaymentProvider,
  type GatewayStatus,
} from './payment.provider';

/**
 * Statuts de paiement déjà réglés : aucune transition ne peut les rouvrir.
 *
 * `EXPIRED` en fait partie depuis que l'expiration rend le stock : sans lui,
 * un webhook tardif rejouerait le règlement d'une commande déjà annulée et
 * re-décrémenterait le rayon.
 */
const SETTLED = ['SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;

/**
 * Issue d'un règlement.
 *
 * Volontairement distinct de `GatewayStatus` : aucun agrégateur ne renvoie
 * jamais « expiré ». L'expiration est NOTRE règle — la fenêtre que nous
 * laissons au client pour valider sur son téléphone — et elle se traite comme
 * un échec du point de vue du stock et de la commande.
 */
type SettlementOutcome = 'PAID' | 'FAILED' | 'EXPIRED';

/**
 * Paiements traités par passage du job de réconciliation.
 *
 * Borne délibérée : chaque vérification auprès du fournisseur est un appel
 * réseau. Sans plafond, un incident laissant des milliers de transactions
 * ouvertes produirait un balayage de plusieurs minutes tenant des connexions
 * de base. Le reliquat est repris au tour suivant.
 */
const RECONCILIATION_BATCH = 200;

/**
 * Ce que `status()` renvoie au client.
 *
 * Ce type doit être ÉCRIT, pas inféré : `status()` s'appelle elle-même après
 * avoir réglé un paiement, et TypeScript ne sait pas inférer le type de
 * retour d'une méthode qui se référence elle-même (TS7023). Sans cette
 * annotation, le fichier ne compile pas — et il est importé par presque
 * toutes les suites e2e, qui échouaient donc toutes à démarrer.
 */
export interface PaymentStatusView {
  id: string;
  status: string;
  method: string;
  provider: string | null;
  amount: number;
  providerReference: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  failureReason: string | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
  ) {}

  /** Fenêtre de validation laissée au client sur son téléphone. */
  private get expiryMinutes(): number {
    const raw = Number.parseInt(
      this.config.get<string>('PAYMENT_EXPIRY_MINUTES') ?? '30',
      10,
    );
    return Number.isNaN(raw) ? 30 : Math.min(240, Math.max(5, raw));
  }

  /** Exposé au client : sert à afficher les bons moyens de paiement. */
  activeProvider() {
    return {
      provider: this.gateway.name,
      configured: this.gateway.isConfigured(),
    };
  }

  /**
   * Ouvre une transaction pour une commande en attente de paiement.
   *
   * Rejouable : si le client abandonne la page de l'opérateur et revient, un
   * nouvel appel rouvre une transaction plutôt que de le laisser coincé.
   */
  async initiate(userId: string, reference: string) {
    const order = await this.prisma.db.order.findUnique({
      where: { reference },
      select: {
        id: true,
        reference: true,
        userId: true,
        status: true,
        total: true,
        payment: {
          select: { id: true, method: true, provider: true, status: true },
        },
        user: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    // Même réponse pour « inexistante » et « pas la vôtre » : autrement, une
    // énumération de références révèle quelles commandes existent.
    if (!order || order.userId !== userId) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Cette commande est introuvable.',
      });
    }
    if (!order.payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Aucun paiement rattaché à cette commande.',
      });
    }
    if (order.payment.method === 'CASH_ON_DELIVERY') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_APPLICABLE',
        message: 'Cette commande est réglée à la livraison.',
      });
    }
    if (order.payment.status === 'SUCCEEDED') {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_SETTLED',
        message: 'Cette commande est déjà payée.',
      });
    }
    if (order.status === 'CANCELLED') {
      throw new ConflictException({
        code: 'ORDER_CANCELLED',
        message: 'Cette commande a été annulée.',
      });
    }
    if (!this.gateway.isConfigured()) {
      // 503 et non 500 : ce n'est pas un bug, c'est une passerelle non
      // configurée. Le client peut réessayer plus tard ou payer à la livraison.
      throw new ServiceUnavailableException({
        code: 'PAYMENT_UNAVAILABLE',
        message: "Le paiement en ligne est momentanément indisponible.",
      });
    }

    const result = await this.runGateway(() =>
      this.gateway.initiate({
        orderReference: order.reference,
        amountXof: order.total,
        customerName: `${order.user.firstName} ${order.user.lastName}`.trim(),
        customerPhone: order.user.phone,
        provider: order.payment!.provider,
      }),
    );

    await this.prisma.db.payment.update({
      where: { id: order.payment.id },
      data: {
        providerReference: result.providerReference,
        status:
          result.status === 'PENDING' ? 'AWAITING_CONFIRMATION' : 'PENDING',
        expiresAt: new Date(Date.now() + this.expiryMinutes * 60_000),
        failureReason: null,
      },
    });

    // Un pilote peut trancher immédiatement (simulation, refus direct de
    // l'agrégateur). Dans ce cas le règlement a lieu tout de suite.
    if (result.status !== 'PENDING') {
      await this.settle(order.payment.id, result.status, result.message);
    }

    return {
      status: result.status,
      checkoutUrl: result.checkoutUrl,
      message: result.message,
      reference: order.reference,
    };
  }

  /**
   * État du paiement, avec filet de sécurité.
   *
   * Si la transaction est ouverte depuis un moment et qu'aucun webhook n'est
   * arrivé, on interroge le fournisseur. C'est ce qui rattrape les callbacks
   * perdus — le mode de panne le plus courant du paiement mobile.
   */
  async status(
    userId: string,
    reference: string,
  ): Promise<PaymentStatusView> {
    const payment = await this.prisma.db.payment.findFirst({
      where: { order: { reference, userId } },
      select: {
        id: true,
        status: true,
        method: true,
        provider: true,
        amount: true,
        providerReference: true,
        expiresAt: true,
        paidAt: true,
        failureReason: true,
      },
    });

    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Aucun paiement rattaché à cette commande.',
      });
    }

    const pending = payment.status === 'AWAITING_CONFIRMATION';
    if (pending && payment.providerReference && !this.gateway.callbackIsProof) {
      try {
        const check = await this.gateway.verify(payment.providerReference);
        if (check.status !== 'PENDING') {
          await this.settle(payment.id, check.status, check.message);
          return this.status(userId, reference);
        }
      } catch (error) {
        // Le filet est un confort, pas une obligation : un fournisseur
        // injoignable ne doit pas empêcher le client de consulter sa commande.
        this.logger.warn(
          `Vérification impossible pour ${payment.providerReference} : ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      }
    }

    // Une transaction expirée sans nouvelle reste bloquée sinon pour toujours.
    //
    // Le règlement passe par `settle()` et NON par une écriture directe du
    // statut. La distinction n'est pas cosmétique : `settle()` est le seul
    // endroit qui rende le stock et annule la commande. Tant que cette branche
    // écrivait `EXPIRED` elle-même, chaque paiement abandonné retirait
    // définitivement de la marchandise du rayon — précisément ce que le
    // commentaire de `settle()` disait vouloir éviter.
    if (pending && payment.expiresAt && payment.expiresAt < new Date()) {
      await this.settle(
        payment.id,
        'EXPIRED',
        'Délai de validation dépassé.',
      );
      return this.status(userId, reference);
    }

    return payment;
  }

  /**
   * Balayage des paiements restés en attente. Appelé par le job de
   * réconciliation.
   *
   * Raison d'être : `status()` ne se déclenche que si le CLIENT rouvre son
   * écran. Un utilisateur qui abandonne en cours de paiement — ou qui
   * désinstalle — laissait donc sa commande en attente indéfiniment, stock
   * réservé compris. Ce balayage est ce qui garantit qu'une commande finit
   * toujours par atteindre un état terminal, que le client revienne ou non.
   *
   * Deux traitements, dans cet ordre :
   *   1. délai dépassé → règlement en `EXPIRED` (rend le stock) ;
   *   2. délai non dépassé mais transaction ouverte → on demande au
   *      fournisseur, ce qui rattrape les webhooks perdus.
   *
   * Le lot est borné : un incident qui laisserait des milliers de paiements
   * ouverts ne doit pas se traduire par un balayage interminable qui tient la
   * base. Le reste part au tour suivant.
   */
  async reconcilePending(
    now = new Date(),
  ): Promise<{ expired: number; resolved: number }> {
    const pending = await this.prisma.db.payment.findMany({
      where: { status: 'AWAITING_CONFIRMATION' },
      select: { id: true, expiresAt: true, providerReference: true },
      orderBy: { createdAt: 'asc' },
      take: RECONCILIATION_BATCH,
    });

    let expired = 0;
    let resolved = 0;

    for (const payment of pending) {
      // Un paiement en erreur ne doit pas interrompre le balayage des
      // suivants : chacun est isolé.
      try {
        if (payment.expiresAt && payment.expiresAt < now) {
          await this.settle(payment.id, 'EXPIRED', 'Délai de validation dépassé.');
          expired += 1;
          continue;
        }

        if (payment.providerReference && !this.gateway.callbackIsProof) {
          const check = await this.gateway.verify(payment.providerReference);
          if (check.status !== 'PENDING') {
            await this.settle(payment.id, check.status, check.message);
            resolved += 1;
          }
        }
      } catch (error) {
        this.logger.warn(
          `Réconciliation du paiement ${payment.id} impossible : ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      }
    }

    return { expired, resolved };
  }

  /**
   * Traite l'appel entrant de l'opérateur.
   *
   * Renvoie toujours sans lever pour un paiement inconnu : un opérateur qui
   * reçoit une erreur rejoue en boucle. On journalise et on acquitte.
   */
  async handleCallback(
    providerName: string,
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
  ) {
    if (providerName !== this.gateway.name) {
      // Callback d'un fournisseur qui n'est plus actif : on refuse de traiter
      // plutôt que de le lire avec les mauvaises clés de signature.
      this.logger.warn(
        `Callback « ${providerName} » ignoré : fournisseur actif « ${this.gateway.name} ».`,
      );
      return { received: true };
    }

    let reading;
    try {
      reading = this.gateway.readCallback(body, headers);
    } catch (error) {
      // Signature invalide : le message est acquitté sans rien faire. Renvoyer
      // une erreur apprendrait à un attaquant qu'il a touché une vraie route,
      // et déclencherait une tempête de rejeux si la cause est de notre côté.
      // Journalisé en `error` : un secret mal configuré rejette 100 % des
      // callbacks légitimes, il faut que cela se voie immédiatement.
      this.logger.error(
        `Callback ${providerName} rejeté : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
      return { received: true };
    }

    const payment = await this.prisma.db.payment.findFirst({
      where: reading.providerReference
        ? { providerReference: reading.providerReference }
        : { order: { reference: reading.orderReference } },
      select: { id: true, status: true, providerReference: true },
    });

    if (!payment) {
      this.logger.warn(
        `Callback sans paiement correspondant (transaction « ${reading.providerReference} », commande « ${reading.orderReference} »).`,
      );
      return { received: true };
    }

    if ((SETTLED as readonly string[]).includes(payment.status)) {
      // Cas à ne JAMAIS avaler en silence : l'opérateur annonce un paiement
      // réussi sur une transaction que nous avons déjà expirée. L'argent est
      // parti du compte du client, la commande a été annulée et le stock
      // rendu. Il n'existe pas encore de chemin de remboursement automatique
      // (hors périmètre), donc la seule issue honnête est de le rendre visible
      // en exploitation pour un remboursement manuel.
      if (payment.status === 'EXPIRED' && reading.status === 'PAID') {
        this.logger.error(
          `REMBOURSEMENT À TRAITER : paiement réussi reçu après expiration ` +
            `(transaction « ${reading.providerReference} », commande ` +
            `« ${reading.orderReference} »). La commande est annulée et le ` +
            `stock rendu : le client a payé sans contrepartie.`,
        );
        return { received: true };
      }

      // Rejeu d'un webhook déjà traité : acquitter sans rien refaire.
      return { received: true };
    }

    let outcome: GatewayStatus = reading.status;
    let message = '';

    // Invariant nº 1 : un succès annoncé n'est jamais cru sur parole.
    if (outcome === 'PAID' && !this.gateway.callbackIsProof) {
      const check = await this.runGateway(() =>
        this.gateway.verify(payment.providerReference ?? reading.providerReference),
      );
      outcome = check.status;
      message = check.message;
    }

    if (outcome === 'PENDING') return { received: true };

    await this.settle(payment.id, outcome, message);
    return { received: true };
  }

  /**
   * Inscrit l'issue du paiement : commande, stock, journal, notification.
   *
   * Idempotent par construction — la relecture du statut se fait à l'intérieur
   * de la transaction, donc deux webhooks simultanés ne peuvent pas régler
   * deux fois le même paiement.
   */
  private async settle(
    paymentId: string,
    outcome: SettlementOutcome,
    message: string,
  ) {
    const settled = await this.prisma.db.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          status: true,
          order: {
            select: {
              id: true,
              reference: true,
              userId: true,
              status: true,
              items: { select: { variantId: true, quantity: true } },
            },
          },
        },
      });

      if (!payment || (SETTLED as readonly string[]).includes(payment.status)) {
        return null;
      }

      const order = payment.order;

      if (outcome === 'PAID') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'SUCCEEDED', paidAt: new Date() },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CONFIRMED' },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            status: 'CONFIRMED',
            comment: 'Paiement confirmé.',
          },
        });
        return { order, outcome };
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: outcome === 'EXPIRED' ? 'EXPIRED' : 'FAILED',
          failureReason:
            message.slice(0, 255) ||
            (outcome === 'EXPIRED'
              ? 'Délai de validation dépassé.'
              : 'Paiement refusé.'),
        },
      });

      // Le stock avait été décrémenté à la création de la commande : un
      // paiement refusé ou abandonné doit le rendre, sinon le rayon se vide de
      // commandes qui n'ont jamais été payées.
      if (order.status !== 'CANCELLED') {
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            status: 'CANCELLED',
            comment: message.slice(0, 500) || 'Paiement refusé.',
          },
        });
      }

      return { order, outcome };
    });

    if (!settled) return;

    // Hors transaction : un service de notification lent ne doit pas maintenir
    // un verrou sur les lignes de stock.
    await this.notifications.notify({
      userId: settled.order.userId,
      type: outcome === 'PAID' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
      reference: settled.order.reference,
      orderId: settled.order.id,
    });
    await this.notifications.notifyOrderStatus({
      userId: settled.order.userId,
      status: outcome === 'PAID' ? 'CONFIRMED' : 'CANCELLED',
      reference: settled.order.reference,
      orderId: settled.order.id,
    });
  }

  /**
   * Traduit une panne de passerelle en 503.
   *
   * Une erreur réseau chez l'agrégateur n'est pas un bug de notre API : la
   * distinction compte pour la supervision comme pour le message affiché.
   */
  private async runGateway<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof PaymentGatewayError) {
        this.logger.error(error.message);
        throw new ServiceUnavailableException({
          code: 'PAYMENT_GATEWAY_ERROR',
          message:
            "Le service de paiement est momentanément indisponible. Réessayez dans un instant.",
        });
      }
      throw error;
    }
  }
}
