import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import type { Role } from '@agrim/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { generateReferralCode } from '../referrals/referrals.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Normalise un numéro ivoirien en 10 chiffres (retire +225 et espaces). */
function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, '').replace(/^\+225/, '');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const phone = normalizePhone(dto.phone);

    const existing = await this.prisma.db.user.findUnique({ where: { phone } });
    if (existing) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_USED',
        message: 'Ce numéro est déjà associé à un compte.',
      });
    }

    const passwordHash = await argon2.hash(dto.password);

    // Parrain éventuel : un code inconnu ou invalide n'échoue jamais
    // l'inscription, il est simplement ignoré — bloquer un compte pour une
    // faute de frappe sur le code d'un tiers serait disproportionné.
    let referredById: string | null = null;
    if (dto.referralCode) {
      const referrer = await this.prisma.db.user.findUnique({
        where: { referralCode: dto.referralCode.trim().toUpperCase() },
        select: { id: true },
      });
      referredById = referrer?.id ?? null;
    }

    const user = await this.prisma.db.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone,
        email: dto.email?.trim() ? dto.email.trim() : null,
        passwordHash,
        role: 'CLIENT',
        referralCode: await this.uniqueReferralCode(),
        referredById,
        // Le panier accompagne le compte dès sa création.
        cart: { create: {} },
      },
    });

    const tokens = await this.issueTokens(user.id, user.phone, user.role);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async login(dto: LoginDto) {
    const phone = normalizePhone(dto.phone);
    const user = await this.prisma.db.user.findUnique({ where: { phone } });

    // Message identique si le compte n'existe pas ou si le mot de passe est
    // faux : on n'indique pas quels numéros sont enregistrés.
    const invalid = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Numéro ou mot de passe incorrect.',
    });
    if (!user || !user.isActive) throw invalid;

    // `argon2.verify` lève si l'empreinte stockée est illisible (compte hérité,
    // donnée corrompue). Sans ce filet, l'appelant recevrait une 500 et une
    // trace technique là où la réponse correcte reste « identifiants
    // invalides ».
    const ok = await argon2
      .verify(user.passwordHash, dto.password)
      .catch(() => false);
    if (!ok) throw invalid;

    const tokens = await this.issueTokens(user.id, user.phone, user.role);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  /**
   * Rotation : le refresh token présenté est révoqué et remplacé.
   * Un token déjà révoqué qui revient signale un vol probable — on coupe
   * alors toutes les sessions de l'utilisateur.
   */
  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Session expirée. Veuillez vous reconnecter.',
      });
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.db.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Session expirée. Veuillez vous reconnecter.',
      });
    }

    if (stored.revokedAt) {
      await this.prisma.db.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Session invalidée pour raison de sécurité.',
      });
    }

    const user = await this.prisma.db.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Compte indisponible.',
      });
    }

    await this.prisma.db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, user.phone, user.role);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.db.refreshToken.updateMany({
        where: { userId, tokenHash: this.hashToken(refreshToken) },
        data: { revokedAt: new Date() },
      });
      return;
    }
    // Sans token fourni : on ferme toutes les sessions.
    await this.prisma.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Mot de passe actuel incorrect.',
      });
    }

    await this.prisma.db.$transaction([
      this.prisma.db.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(newPassword) },
      }),
      // Un changement de mot de passe invalide les sessions existantes.
      this.prisma.db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueTokens(
    userId: string,
    phone: string,
    role: Role,
  ): Promise<TokenPair> {
    const payload = { sub: userId, phone, role };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      // `ms.StringValue` ('15m'…) : la valeur vient d'une config validée.
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL') as never,
    });

    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomUUID() },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL') as never,
      },
    );

    const decoded = this.jwt.decode(refreshToken) as { exp: number };

    // Seul le HACHÉ est persisté : une fuite de base ne donne pas de session.
    await this.prisma.db.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Code de parrainage unique. Les collisions sont extrêmement rares (charset
   * de 32 caractères sur 6 positions), mais le retry coûte trois fois rien et
   * élimine le risque plutôt que de le tolérer.
   */
  private async uniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateReferralCode();
      const exists = await this.prisma.db.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw new Error('Impossible de générer un code de parrainage unique.');
  }

  private toPublicUser(user: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    role: Role;
    isActive: boolean;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
