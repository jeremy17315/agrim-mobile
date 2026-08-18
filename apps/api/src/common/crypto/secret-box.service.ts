import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * Chiffrement symétrique des données courtes qui doivent rester lisibles par
 * leur propriétaire (aujourd'hui : le code de livraison).
 *
 * À ne pas confondre avec le hachage. Un mot de passe se hache — personne n'a
 * besoin de le relire. Un code OTP doit être RELU par le client qui va le
 * dicter : il faut donc un chiffrement réversible, pas une empreinte.
 *
 * AES-256-GCM : chiffrement authentifié. Une altération du texte chiffré ou de
 * l'IV fait échouer le déchiffrement au lieu de produire une valeur erronée
 * silencieuse.
 */
@Injectable()
export class SecretBoxService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('ENCRYPTION_KEY');

    // La clé AES doit faire exactement 32 octets. Dériver par SHA-256 accepte
    // une phrase secrète de longueur quelconque sans exiger un format binaire
    // dans le fichier d'environnement. La validation d'environnement impose
    // déjà une longueur minimale à l'entrée.
    this.key = createHash('sha256').update(secret).digest();
  }

  /**
   * Chiffre une valeur. Le format de sortie `iv:tag:données` (base64url) est
   * autonome : tout ce qu'il faut pour déchiffrer est dans la chaîne, sauf la
   * clé.
   */
  encrypt(plaintext: string): string {
    // IV aléatoire à chaque appel : deux codes identiques ne produisent jamais
    // le même texte chiffré, sinon la table révélerait les doublons.
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return [
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  /**
   * Déchiffre une valeur produite par `encrypt`.
   *
   * Renvoie `null` si la valeur est illisible (clé changée, donnée corrompue,
   * altération). L'appelant traite ce cas comme un code absent : mieux vaut
   * demander une régénération qu'exposer une erreur technique.
   */
  decrypt(payload: string): string | null {
    try {
      const [rawIv, rawTag, rawData] = payload.split(':');
      if (!rawIv || !rawTag || !rawData) return null;

      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(rawIv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(rawTag, 'base64url'));

      return Buffer.concat([
        decipher.update(Buffer.from(rawData, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
