/**
 * Contrat de stockage de fichiers.
 *
 * Aucun fournisseur n'apparaît ici. Le reste de l'application ne connaît que
 * cette interface : passer du disque local à un stockage S3-compatible se fera
 * en ajoutant un pilote, sans toucher aux modules métier.
 */

/** Fichier reçu, indépendant du transport (multipart aujourd'hui). */
export interface StorageUpload {
  buffer: Buffer;
  mimeType: string;
  /** Nom d'origine, utilisé uniquement pour déduire une extension. */
  originalName: string;
}

/** Résultat d'un dépôt : de quoi retrouver et servir le fichier. */
export interface StoredFile {
  /** Chemin logique dans le dépôt (jamais un chemin disque absolu). */
  key: string;
  /** URL de consultation. */
  url: string;
  sizeBytes: number;
  mimeType: string;
}

export abstract class StorageProvider {
  /**
   * Dépose un fichier dans un dossier logique (« proofs », « products »…).
   * L'implémentation choisit le nom final : jamais celui fourni par le client.
   */
  abstract put(folder: string, file: StorageUpload): Promise<StoredFile>;

  /**
   * Lit un fichier. Renvoie `null` s'il n'existe pas, pour que l'appelant
   * réponde 404 plutôt que de laisser fuiter une erreur système.
   */
  abstract read(key: string): Promise<Buffer | null>;

  /** Supprime un fichier. Idempotent : l'absence n'est pas une erreur. */
  abstract remove(key: string): Promise<void>;
}

/** Jeton d'injection. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
