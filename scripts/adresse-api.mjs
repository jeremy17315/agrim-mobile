#!/usr/bin/env node
/**
 * Affiche l'URL d'API à utiliser pour un APK de test.
 *
 * Raison d'être : l'erreur numéro un d'un premier APK est une URL d'API
 * pointant sur `localhost`. Sur un téléphone, `localhost` désigne le téléphone
 * lui-même — l'application ne trouve rien et n'affiche qu'une erreur réseau.
 * Il faut l'adresse de la machine qui exécute l'API, sur le réseau local.
 *
 * Usage : node scripts/adresse-api.mjs
 */
import { networkInterfaces } from 'node:os';

const PORT = process.env.API_PORT ?? '3000';

/** Adresses IPv4 privées, hors boucle locale et interfaces virtuelles. */
function localAddresses() {
  const found = [];

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;

      // Interfaces de conteneurs et de VM : joignables depuis la machine, pas
      // depuis un téléphone. Les signaler éviterait une fausse piste.
      const virtual = /^(docker|br-|veth|virbr|lo)/.test(name);
      const privateRange =
        /^10\./.test(address.address) ||
        /^192\.168\./.test(address.address) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address.address);

      found.push({ name, ip: address.address, virtual, privateRange });
    }
  }

  return found;
}

const all = localAddresses();
const usable = all.filter((a) => !a.virtual && a.privateRange);

console.log('\nAdresses détectées sur cette machine :\n');
if (all.length === 0) {
  console.log('  (aucune interface réseau IPv4 externe)');
} else {
  for (const a of all) {
    const flag = usable.includes(a) ? '  ✔' : '  ·';
    const note = a.virtual
      ? ' (interface virtuelle — non joignable depuis un téléphone)'
      : a.privateRange
        ? ''
        : ' (hors plage privée)';
    console.log(`${flag} ${a.ip.padEnd(16)} ${a.name}${note}`);
  }
}

console.log('\nURL à utiliser dans eas.json (profil « apk ») :\n');
if (usable.length === 0) {
  console.log(
    '  Aucune adresse locale exploitable. Sur une machine distante ou un\n' +
      "  conteneur, exposez plutôt l'API par un tunnel HTTPS public et\n" +
      '  utilisez cette URL-là.',
  );
} else {
  for (const a of usable) {
    console.log(`  http://${a.ip}:${PORT}/api/v1`);
  }
  console.log(
    '\nVérifiez depuis le téléphone, sur le MÊME réseau Wi-Fi, en ouvrant :\n' +
      `  http://${usable[0].ip}:${PORT}/api/v1/health`,
  );
}

console.log(
  '\nRappel : le téléphone et cette machine doivent être sur le même réseau,\n' +
    'et le pare-feu doit laisser passer le port ' +
    PORT +
    '.\n',
);
