// Metro doit résoudre les paquets du monorepo (node_modules hissés à la racine)
// et surveiller packages/contracts pour recharger à chaud le contrat partagé.
//
// `disableHierarchicalLookup` est volontairement laissé à sa valeur par défaut :
// expo-doctor le signale comme dangereux, et la remontée hiérarchique est
// justement ce qui permet de résoudre les paquets hissés par npm workspaces.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
