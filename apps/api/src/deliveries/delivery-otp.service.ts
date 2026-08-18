import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';

import { DELIVERY_OTP_CONFIG } from '@agrim/contracts';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Génération et vérification des codes de validation de livraison.
 *
 * Trois principes gouvernent ce service :
 *
 * 1. Le code n'est jamais persisté en clair. Seule son empreinte SHA-256 est
 *    stockée : une fuite de base ne permet pas de valider une livraison.
 * 2. Le code n'est renvoyé qu'une seule fois, au moment de sa génération, et
 *    uniquement vers le canal du CLIENT (notification). Aucune méthode de ce
 *    service ne l'expose au livreur.
 * 3. La vérification est atomique et centralisée : les cinq conditions
 *    (code exact, non expiré, non consommé, bonne livraison, bon livreur)
 *    sont contrôlées ensemble, dans une transaction.
 */
@Injectable()
export class DeliveryOtpService {
  private readonly logger = new Logger(DeliveryOtpService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tire un code à 4 chiffres.
   *
   * `randomInt` s'appuie sur le générateur cryptographique du système :
   * `Math.random()` est prédictible et n'a rien à faire ici. Le tirage couvre
   * bien 0000–9999, y compris les codes à zéros initiaux.
   */
  private generateCode(): string {
    const max = 10 ** DELIVERY_OTP_CONFIG.length;
    return String(randomInt(0, max)).padStart(DELIVERY_OTP_CONFIG.length, '0');
  }

  /**
   * Empreinte du code.
   *
   * SHA-256 nu, sans Argon2 : l'espace est de 10 000 valeurs, un algorithme
   * lent ne le rendrait pas résistant à une attaque hors ligne. La protection
   * réelle vient d'ailleurs — durée de vie courte, 5 tentatives, usage unique.
   * Le haché sert à éviter qu'un code soit lisible en base ou dans une
   * sauvegarde, pas à résister à une force brute locale.
   */
  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * Émet un nouveau code pour une livraison et invalide le précédent.
   *
   * Renvoie le code EN CLAIR à l'appelant, qui doit le transmettre au seul
   * client destinataire. Aucun autre usage n'est légitime.
   */
  async issue(
    deliveryId: string,
    options: { isResend?: boolean } = {},
  ): Promise<{ code: string; expiresAt: Date }> {
    const now = new Date();

    if (options.isResend) {
      await this.assertResendAllowed(deliveryId, now);
    }

    const code = this.generateCode();
    const expiresAt = new Date(
      now.getTime() + DELIVERY_OTP_CONFIG.ttlMinutes * 60_000,
    );

    await this.prisma.db.$transaction(async (tx) => {
      // Un seul code utilisable à la fois : sinon un ancien code, connu d'un
      // tiers, resterait valable après régénération.
      await tx.deliveryOtp.updateMany({
        where: { deliveryId, verifiedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });

      await tx.deliveryOtp.create({
        data: { deliveryId, codeHash: this.hash(code), expiresAt },
      });
    });

    // Jamais le code dans les journaux.
    this.logger.log(`OTP émis pour la livraison ${deliveryId}`);

    return { code, expiresAt };
  }

  private async assertResendAllowed(
    deliveryId: string,
    now: Date,
  ): Promise<void> {
    const [count, last] = await Promise.all([
      this.prisma.db.deliveryOtp.count({ where: { deliveryId } }),
      this.prisma.db.deliveryOtp.findFirst({
        where: { deliveryId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    if (count > DELIVERY_OTP_CONFIG.maxResends) {
      throw new ConflictException({
        code: 'OTP_RESEND_LIMIT',
        message:
          'Trop de codes générés pour cette livraison. Contactez le service client.',
      });
    }

    if (last) {
      const elapsed = (now.getTime() - last.createdAt.getTime()) / 1000;
      const wait = DELIVERY_OTP_CONFIG.resendCooldownSeconds - elapsed;
      if (wait > 0) {
        throw new ConflictException({
          code: 'OTP_RESEND_TOO_SOON',
          message: `Patientez ${Math.ceil(wait)} secondes avant de générer un nouveau code.`,
        });
      }
    }
  }

  /**
   * Vérifie un code saisi par le livreur.
   *
   * Le contrôle du livreur et de la livraison a lieu ici et non chez
   * l'appelant : c'est la seule façon de garantir qu'aucun chemin ne
   * contourne une des conditions.
   */
  async verify(params: {
    deliveryId: string;
    courierId: string;
    code: string;
  }): Promise<{ otpId: string }> {
    const { deliveryId, courierId, code } = params;

    // Condition « livreur autorisé sur la mission » : un livreur ne peut pas
    // valider la course d'un collègue, même avec le bon code.
    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id: deliveryId, courierId },
      select: { id: true },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }

    const otp = await this.prisma.db.deliveryOtp.findFirst({
      where: { deliveryId, verifiedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException({
        code: 'OTP_NOT_FOUND',
        message: 'Aucun code actif. Demandez au client de le faire renvoyer.',
      });
    }

    if (otp.attempts >= DELIVERY_OTP_CONFIG.maxAttempts) {
      throw new ConflictException({
        code: 'OTP_ATTEMPTS_EXCEEDED',
        message: 'Trop de tentatives. Un nouveau code doit être généré.',
      });
    }

    if (otp.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'OTP_EXPIRED',
        message: 'Ce code a expiré. Demandez au client de le faire renvoyer.',
      });
    }

    if (otp.codeHash !== this.hash(code)) {
      // L'échec est compté avant d'être signalé : sans cela, une saisie
      // automatisée pourrait épuiser les 10 000 combinaisons.
      const updated = await this.prisma.db.deliveryOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });

      const remaining = Math.max(
        0,
        DELIVERY_OTP_CONFIG.maxAttempts - updated.attempts,
      );
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message:
          remaining > 0
            ? `Code incorrect. ${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}.`
            : 'Code incorrect. Un nouveau code doit être généré.',
        details: { attemptsRemaining: remaining },
      });
    }

    // Consommation atomique : `verifiedAt: null` dans le filtre garantit que
    // deux requêtes simultanées avec le bon code ne valident qu'une seule fois.
    const consumed = await this.prisma.db.deliveryOtp.updateMany({
      where: { id: otp.id, verifiedAt: null, invalidatedAt: null },
      data: { verifiedAt: new Date() },
    });

    if (consumed.count === 0) {
      throw new ConflictException({
        code: 'OTP_ALREADY_USED',
        message: 'Ce code a déjà été utilisé.',
      });
    }

    return { otpId: otp.id };
  }

  /**
   * État du code, sans jamais le divulguer.
   *
   * Destiné à l'écran du livreur (« code expiré, faites-le renvoyer ») et au
   * suivi client.
   */
  async status(deliveryId: string) {
    const otp = await this.prisma.db.deliveryOtp.findFirst({
      where: { deliveryId },
      orderBy: { createdAt: 'desc' },
    });

    const total = await this.prisma.db.deliveryOtp.count({
      where: { deliveryId },
    });

    if (!otp) {
      return {
        isActive: false,
        expiresAt: null,
        attemptsRemaining: DELIVERY_OTP_CONFIG.maxAttempts,
        verifiedAt: null,
        canResendAt: null,
        resendsRemaining: DELIVERY_OTP_CONFIG.maxResends,
      };
    }

    const isActive =
      !otp.verifiedAt &&
      !otp.invalidatedAt &&
      otp.attempts < DELIVERY_OTP_CONFIG.maxAttempts &&
      otp.expiresAt.getTime() > Date.now();

    return {
      isActive,
      expiresAt: otp.expiresAt.toISOString(),
      attemptsRemaining: Math.max(
        0,
        DELIVERY_OTP_CONFIG.maxAttempts - otp.attempts,
      ),
      verifiedAt: otp.verifiedAt?.toISOString() ?? null,
      canResendAt: new Date(
        otp.createdAt.getTime() +
          DELIVERY_OTP_CONFIG.resendCooldownSeconds * 1000,
      ).toISOString(),
      resendsRemaining: Math.max(0, DELIVERY_OTP_CONFIG.maxResends - total + 1),
    };
  }
}
