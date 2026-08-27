// Metro doit résoudre les paquets du monorepo (node_modules hissés à la racine)
// et surveiller packages/contracts pour recharger à chaud le contrat partagé.
//
// `disableHierarchicalLookup` est volontairement laissé à sa valeur par défaut :
// expo-doctor le signale comme dangereux, et la remontée hiérarchique est
// justement ce qui permet de résoudre les paquets hissés par npm workspaces.
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Expo SDK 57 publie expo-modules-core avec "main": "src/index.ts" (pas de
// build/index.js). Metro, surtout sur Windows et en rendu web "static",
// trouve le package.json mais ne voit pas le .ts — d'où l'erreur
// « main module field that could not be resolved … src/index.ts »
// depuis expo-font/build/server.js.
const sourceExts = config.resolver.sourceExts ?? [];
config.resolver.sourceExts = Array.from(new Set([...sourceExts, 'ts', 'tsx', 'mjs', 'cjs']));

function fichierExpoModulesCore() {
  const candidats = [
    path.join(workspaceRoot, 'node_modules', 'expo-modules-core', 'src', 'index.ts'),
    path.join(projectRoot, 'node_modules', 'expo-modules-core', 'src', 'index.ts'),
  ];
  for (const fichier of candidats) {
    if (fs.existsSync(fichier)) {
      return fichier;
    }
  }
  try {
    return require.resolve('expo-modules-core/src/index.ts', {
      paths: [projectRoot, workspaceRoot],
    });
  } catch {
    return null;
  }
}

const resoudreDefaut = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo-modules-core') {
    const fichier = fichierExpoModulesCore();
    if (fichier) {
      return { type: 'sourceFile', filePath: fichier };
    }
  }
  if (resoudreDefaut) {
    return resoudreDefaut(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

/**
 * Proxy de développement pour l'aperçu web.
 *
 * Le navigateur qui affiche l'aperçu n'est pas la machine qui exécute l'API :
 * il ne peut pas joindre 127.0.0.1:3000. On expose donc l'API sous le même
 * origine que le bundle, via un chemin relatif `/api/v1`.
 *
 * Uniquement destiné au développement web. Sur un appareil réel, l'application
 * appelle directement EXPO_PUBLIC_API_URL.
 *
 * `API_PROXY_TARGET` accepte une URL complète (http ou https, utile pour
 * pointer vers une API déployée, ex. Railway) ; à défaut, `API_PROXY_HOST`/
 * `API_PROXY_PORT` retombent sur une API locale en clair.
 */
const API_TARGET = process.env.API_PROXY_TARGET
  ? new URL(process.env.API_PROXY_TARGET)
  : new URL(`http://${process.env.API_PROXY_HOST ?? '127.0.0.1'}:${process.env.API_PROXY_PORT ?? 3000}`);

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url || !req.url.startsWith('/api/')) {
      return middleware(req, res, next);
    }

    const transport = API_TARGET.protocol === 'https:' ? https : http;
    const proxyReq = transport.request(
      {
        host: API_TARGET.hostname,
        port: API_TARGET.port || (API_TARGET.protocol === 'https:' ? 443 : 80),
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: API_TARGET.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      },
    );

    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 502, code: 'API_UNREACHABLE', message: 'API injoignable' }));
    });

    req.pipe(proxyReq, { end: true });
    return undefined;
  },
};

module.exports = config;
