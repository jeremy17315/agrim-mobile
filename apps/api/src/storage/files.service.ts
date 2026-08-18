import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  type StorageUpload,
} from './storage.provider';

/**
 * Types acceptés pour une preuve de livraison.
 *
 * Liste blanche volontairement étroite : une preuve est une image, rien
 * d'autre. Accepter un type arbitraire ouvrirait la porte au dépôt de contenu
 * exécutable.
 */
export const PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Taille maximale d'une preuve. Une photo de colis compressée par le mobile
 * pèse quelques centaines de kilo-octets ; 5 Mo laisse une marge confortable
 * sans exposer le serveur à des dépôts abusifs.
 */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

/** Signatures binaires : le type déclaré par le client ne prouve rien. */
const MAGIC_NUMBERS: ReadonlyArray<{
  mime: string;
  test: (b: Buffer) => boolean;
}> = [
  {
    mime: 'image/jpeg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Dépose une preuve et l'enregistre. L'identifiant renvoyé est celui que le
   * livreur joindra à sa preuve de livraison.
   */
  async uploadProof(file: Express.Multer.File | undefined, uploaderId: string) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Aucun fichier reçu.',
      });
    }

    if (!PROOF_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'Format accepté : JPEG, PNG ou WebP.',
      });
    }

    if (file.size > PROOF_MAX_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Le fichier dépasse 5 Mo.',
      });
    }

    // Le type MIME est déclaratif : on vérifie le contenu réel.
    this.assertRealImage(file.buffer, file.mimetype);

    const upload: StorageUpload = {
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
    const stored = await this.storage.put('proofs', upload);

    const asset = await this.prisma.db.fileAsset.create({
      data: {
        key: stored.key,
        url: stored.url,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        uploadedBy: uploaderId,
      },
      select: { id: true, url: true, mimeType: true, sizeBytes: true },
    });

    return asset;
  }

  private assertRealImage(buffer: Buffer, declaredMime: string): void {
    const matcher = MAGIC_NUMBERS.find((m) => m.mime === declaredMime);
    if (!matcher || buffer.length < 12 || !matcher.test(buffer)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_CONTENT',
        message: 'Ce fichier n’est pas une image valide.',
      });
    }
  }
}
