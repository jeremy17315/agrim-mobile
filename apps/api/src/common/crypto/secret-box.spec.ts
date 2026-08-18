import { ConfigService } from '@nestjs/config';

import { SecretBoxService } from './secret-box.service';

/**
 * Chiffrement réversible des données courtes.
 *
 * Le point vérifié ici n'est pas « AES fonctionne » mais que notre usage tient :
 * pas de texte chiffré déterministe, altération détectée, clé étrangère
 * inopérante.
 */
describe('SecretBoxService', () => {
  const build = (key: string) =>
    new SecretBoxService({
      getOrThrow: () => key,
    } as unknown as ConfigService);

  const box = build('cle-de-test-suffisamment-longue-1234567890');

  it('restitue la valeur chiffrée', () => {
    expect(box.decrypt(box.encrypt('4821'))).toBe('4821');
  });

  it('conserve les zéros initiaux', () => {
    expect(box.decrypt(box.encrypt('0007'))).toBe('0007');
  });

  it('produit un texte chiffré différent à chaque appel', () => {
    // IV aléatoire : sinon deux livraisons partageant le même code auraient
    // la même valeur en base, ce qui révélerait les doublons.
    const a = box.encrypt('4821');
    const b = box.encrypt('4821');

    expect(a).not.toBe(b);
    expect(box.decrypt(a)).toBe(box.decrypt(b));
  });

  it('ne laisse pas la valeur en clair dans le texte chiffré', () => {
    expect(box.encrypt('4821')).not.toContain('4821');
  });

  it('refuse une valeur altérée', () => {
    // GCM authentifie : une modification ne doit pas produire un faux code.
    const payload = box.encrypt('4821');
    const [iv, tag, data] = payload.split(':');
    const tampered = `${iv}:${tag}:${data!.slice(0, -2)}XY`;

    expect(box.decrypt(tampered)).toBeNull();
  });

  it('refuse une valeur chiffrée avec une autre clé', () => {
    const other = build('une-tout-autre-cle-de-chiffrement-0987654321');
    expect(box.decrypt(other.encrypt('4821'))).toBeNull();
  });

  it('refuse une valeur mal formée sans lever', () => {
    for (const invalid of ['', 'nimporte-quoi', 'a:b', 'a:b:c']) {
      expect(box.decrypt(invalid)).toBeNull();
    }
  });
});
