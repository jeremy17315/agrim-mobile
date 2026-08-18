import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

import {
  StorageProvider,
  type StorageUpload,
  type StoredFile,
} from './storage.provider';

/**
 * Pilote de stockage sur disque local.
 *
 * Destiné au développement et à un déploiement mono-serveur. Il n'est pas
 * adapté à plusieurs instances (chaque machine aurait ses propres fichiers) :
 * dans ce cas, ajouter un pilote S3-compatible derrière la même interface.
 */
@Injectable()
export class LocalStorageProvider extends StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.get<string>('STORAGE_LOCAL_ROOT') ?? 'storage');
    this.publicBaseUrl = (
      config.get<string>('STORAGE_PUBLIC_URL') ?? 'http://127.0.0.1:3000/files'
    ).replace(/\/+$/, '');
  }

  async put(folder: string, file: StorageUpload): Promise<StoredFile> {
    const safeFolder = this.sanitizeFolder(folder);
    // Nom généré côté serveur : un nom fourni par le client permettrait
    // d'écraser un fichier existant ou de remonter l'arborescence.
    const name = `${randomUUID()}${this.safeExtension(file.originalName)}`;
    const key = `${safeFolder}/${name}`;

    const destination = this.resolveKey(key);
    await mkdir(join(this.root, safeFolder), { recursive: true });
    await writeFile(destination, file.buffer);

    return {
      key,
      url: `${this.publicBaseUrl}/${key}`,
      sizeBytes: file.buffer.byteLength,
      mimeType: file.mimeType,
    };
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Un fichier déjà absent est le résultat attendu.
      if (code !== 'ENOENT') {
        this.logger.warn(`Suppression impossible : ${key}`);
      }
    }
  }

  /** Empêche toute sortie du dossier racine (« ../ », chemin absolu). */
  private resolveKey(key: string): string {
    const target = resolve(this.root, normalize(key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('Chemin de fichier invalide.');
    }
    return target;
  }

  private sanitizeFolder(folder: string): string {
    const cleaned = folder.replace(/[^a-z0-9/_-]/gi, '');
    if (!cleaned) throw new Error('Dossier de stockage invalide.');
    return cleaned;
  }

  /** Extension repartie du nom d'origine, filtrée sur une liste sûre. */
  private safeExtension(originalName: string): string {
    const ext = extname(originalName).toLowerCase();
    return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
  }
}
