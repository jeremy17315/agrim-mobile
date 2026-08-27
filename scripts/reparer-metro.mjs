#!/usr/bin/env node
/**
 * Répare l'erreur Metro :
 *   expo-modules-core … main module field that could not be resolved … src/index.ts
 *
 * Cause habituelle sous Windows : node_modules incomplet (OneDrive, cache npm,
 * installation lancée depuis apps/mobile au lieu de la racine).
 *
 * Usage, depuis E:\agrim-mobile :
 *   node scripts/reparer-metro.mjs
 *   node scripts/reparer-metro.mjs --reinstaller
 */
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const reinstaller = process.argv.includes('--reinstaller');

const cibles = [
  join(racine, 'node_modules', 'expo-modules-core', 'src', 'index.ts'),
  join(racine, 'apps', 'mobile', 'node_modules', 'expo-modules-core', 'src', 'index.ts'),
];

const present = cibles.find((fichier) => existsSync(fichier));

console.log('Dossier projet :', racine);

if (present && !reinstaller) {
  console.log('OK — expo-modules-core est complet :');
  console.log('   ', present);
  console.log('');
  console.log('Relancez ensuite (cache Metro vidé) :');
  console.log('    npm run mobile:web');
  process.exit(0);
}

if (!present) {
  console.log('KO — il manque node_modules/expo-modules-core/src/index.ts');
  console.log('     Installation incomplète, souvent sous Windows.');
}

const aSupprimer = [
  join(racine, 'node_modules'),
  join(racine, 'apps', 'mobile', 'node_modules'),
  join(racine, 'apps', 'mobile', '.expo'),
  join(racine, 'apps', 'api', 'node_modules'),
  join(racine, 'packages', 'contracts', 'node_modules'),
];

if (!reinstaller) {
  console.log('');
  console.log('Pour tout réinstaller proprement :');
  console.log('    node scripts/reparer-metro.mjs --reinstaller');
  process.exit(present ? 0 : 1);
}

console.log('');
console.log('Suppression des dossiers d\'installation…');
for (const dossier of aSupprimer) {
  if (existsSync(dossier)) {
    console.log('  -', dossier);
    rmSync(dossier, { recursive: true, force: true });
  }
}

console.log('');
console.log('npm install (à la racine du monorepo)…');
const install = spawnSync('npm', ['install'], {
  cwd: racine,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (install.status !== 0) {
  console.error('npm install a échoué.');
  process.exit(install.status ?? 1);
}

const apres = cibles.find((fichier) => existsSync(fichier));
if (!apres) {
  console.error('');
  console.error('Toujours introuvable après réinstallation.');
  console.error('Vérifiez que le dossier n\'est pas sur OneDrive « fichiers à la demande ».');
  console.error('Clic droit sur E:\\agrim-mobile → Toujours conserver sur cet appareil.');
  process.exit(1);
}

console.log('');
console.log('OK — fichier retrouvé :', apres);
console.log('Lancez :  npm run mobile:web');
