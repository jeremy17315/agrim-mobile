import { z } from 'zod';

import { apiRequest, setSessionRefresher, setTokenProvider } from './client';
import { ApiError } from './errors';

/**
 * Renouvellement automatique de session.
 *
 * Cette logique est invisible tant qu'elle fonctionne, et catastrophique
 * quand elle échoue : soit l'utilisateur est éjecté en pleine commande, soit
 * des rotations concurrentes déclenchent la détection de réutilisation du
 * serveur et révoquent toute la session.
 */

const schema = z.object({ ok: z.boolean() });

const originalFetch = global.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  global.fetch = originalFetch;
  setTokenProvider(() => null);
  setSessionRefresher(null);
});

it('rejoue la requête avec le nouveau token après un 401', async () => {
  let token = 'expire';
  setTokenProvider(() => token);
  setSessionRefresher(async () => {
    token = 'frais';
    return token;
  });

  const sent: string[] = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push(headers.Authorization ?? '');
    return headers.Authorization === 'Bearer frais'
      ? jsonResponse(200, { ok: true })
      : jsonResponse(401, { code: 'INVALID_TOKEN' });
  }) as unknown as typeof fetch;

  await expect(apiRequest({ path: '/orders', schema })).resolves.toEqual({
    ok: true,
  });

  expect(sent).toEqual(['Bearer expire', 'Bearer frais']);
});

it('ne renouvelle qu’une seule fois pour des requêtes simultanées', async () => {
  let token = 'expire';
  setTokenProvider(() => token);

  const refresher = jest.fn(async () => {
    // Latence réseau réaliste : sans déduplication, les autres requêtes
    // lanceraient chacune leur propre rotation pendant ce délai.
    await new Promise((resolve) => setTimeout(resolve, 20));
    token = 'frais';
    return token;
  });
  setSessionRefresher(refresher);

  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.Authorization === 'Bearer frais'
      ? jsonResponse(200, { ok: true })
      : jsonResponse(401, { code: 'INVALID_TOKEN' });
  }) as unknown as typeof fetch;

  const results = await Promise.all([
    apiRequest({ path: '/a', schema }),
    apiRequest({ path: '/b', schema }),
    apiRequest({ path: '/c', schema }),
  ]);

  expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(refresher).toHaveBeenCalledTimes(1);
});

it('ne réessaie qu’une fois : un second 401 remonte l’erreur', async () => {
  setTokenProvider(() => 'expire');
  const refresher = jest.fn(async () => 'toujours-invalide');
  setSessionRefresher(refresher);

  const fetchMock = jest.fn(async () =>
    jsonResponse(401, { code: 'INVALID_TOKEN' }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;

  await expect(apiRequest({ path: '/orders', schema })).rejects.toBeInstanceOf(
    ApiError,
  );

  // Une seule tentative de renouvellement, deux appels réseau : pas de boucle.
  expect(refresher).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('ne tente aucun renouvellement sur une route publique', async () => {
  setTokenProvider(() => 'expire');
  const refresher = jest.fn(async () => 'frais');
  setSessionRefresher(refresher);

  global.fetch = jest.fn(async () =>
    jsonResponse(401, { code: 'INVALID_CREDENTIALS' }),
  ) as unknown as typeof fetch;

  await expect(
    apiRequest({ path: '/auth/login', schema, isPublic: true }),
  ).rejects.toBeInstanceOf(ApiError);

  // Un mot de passe erroné ne doit surtout pas déclencher une rotation.
  expect(refresher).not.toHaveBeenCalled();
});

it('remonte l’erreur d’origine quand aucun renouvellement n’est possible', async () => {
  setTokenProvider(() => 'expire');
  setSessionRefresher(async () => null);

  global.fetch = jest.fn(async () =>
    jsonResponse(401, { code: 'INVALID_TOKEN' }),
  ) as unknown as typeof fetch;

  await expect(apiRequest({ path: '/orders', schema })).rejects.toMatchObject({
    status: 401,
  });
});
