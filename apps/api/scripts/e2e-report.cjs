/**
 * Canal de diagnostic e2e — TEMPORAIRE, à retirer après résolution.
 *
 * Les logs GitHub Actions sont illisibles depuis le sandbox. Deux canaux
 * de retour lisibles d'ici :
 *  1. les commandes `::error::` — GitHub les transforme en annotations du
 *     check-run, que l'API renvoie même quand les logs restent bloqués ;
 *  2. l'artifact `e2e-rapport` (client officiel), lu par `gh run download`.
 * Ne s'exécute que dans CI.
 */
const fs = require('fs');
const path = require('path');

let resume = { erreur: 'aucun résultat' };
let suites = [];
try {
  const data = JSON.parse(fs.readFileSync(process.argv[2] || '', 'utf8'));
  resume = {
    total: data.numTotalTests,
    passes: data.numPassedTests,
    echoues: data.numFailedTests,
    suitesEnErreur: data.numRuntimeErrorTestSuites,
  };
  suites = (data.testResults || [])
    .filter((r) => r.status === 'failed')
    .map((r) => ({
      fichier: r.name.replace(/^.*src\//, 'src/'),
      message: (r.message || '').slice(0, 700),
      premier: ((r.testResults || []).filter((t) => t.status === 'failed')[0] || {}).fullName,
      echec: (((r.testResults || []).filter((t) => t.status === 'failed')[0] || {}).failureMessages || []).join(' | ').slice(0, 700),
    }));
} catch (e) {
  resume = { erreur: 'aucun fichier de résultats jest: ' + e.message };
}

// 1. Canal annotations: `::error::` (cap ~10/step — on condense).
const lignes = [`RESUME e2e: ${JSON.stringify(resume)}`];
for (const s of suites.slice(0, 8)) {
  lignes.push(`SUITE ${s.fichier} :: ${s.premier || 'chargement'} :: ${(s.echec || s.message || '').split('\n')[0].slice(0, 350)}`);
}
if (suites.length > 8) lignes.push(`(+${suites.length - 8} autres suites en échec)`);
for (const l of lignes) console.log('::error::' + l.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));

// 2. Canal artifact (détail complet).
const repertoire = '/tmp/e2e-rapport';
fs.mkdirSync(repertoire, { recursive: true });
fs.writeFileSync(path.join(repertoire, 'rapport.json'), JSON.stringify({ resume, suites }, null, 2));
(async () => {
  try {
    const { DefaultArtifactClient } = require('@actions/artifact');
    const client = new DefaultArtifactClient();
    const r = await client.uploadArtifact('e2e-rapport', ['rapport.json'], repertoire);
    console.log('artifact publié:', JSON.stringify(r));
  } catch (e) {
    console.log('publication artifact impossible:', (e && e.message) || e);
  }
})();
