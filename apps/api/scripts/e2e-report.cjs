/**
 * Canal de diagnostic e2e — TEMPORAIRE, à retirer après résolution.
 *
 * Les logs GitHub Actions sont illisibles depuis le sandbox de conception.
 * Ce script renvoie le résumé jest par le seul canal lisible d'ici :
 * l'artifact `e2e-rapport` (client officiel @actions/artifact), lu ensuite
 * avec `gh run download`. Ne s'exécute que dans CI.
 */
const fs = require('fs');
const path = require('path');

let corps;
try {
  const data = JSON.parse(fs.readFileSync(process.argv[2] || '', 'utf8'));
  const echecs = (data.testResults || [])
    .filter((r) => r.status === 'failed')
    .map((r) => ({
      suite: r.name,
      message: (r.message || '').slice(0, 2500),
      tests: (r.testResults || [])
        .filter((t) => t.status === 'failed')
        .map((t) => ({
          nom: t.fullName || t.title,
          echec: (t.failureMessages || []).join('\n').slice(0, 1500),
        })),
    }));
  corps = JSON.stringify(
    {
      resume: {
        total: data.numTotalTests,
        passes: data.numPassedTests,
        echoues: data.numFailedTests,
        suitesEnErreur: data.numRuntimeErrorTestSuites,
      },
      suitesEnEchec: echecs,
    },
    null,
    2,
  );
} catch (e) {
  corps = 'Aucun fichier de résultats jest: ' + e.message;
}

const repertoire = '/tmp/e2e-rapport';
fs.mkdirSync(repertoire, { recursive: true });
fs.writeFileSync(path.join(repertoire, 'rapport.json'), corps);

(async () => {
  try {
    // Client officiel : le protocole (runtime URL, token, conteneur blob)
    // est le sien — fini l'artisanat.
    const { DefaultArtifactClient } = require('@actions/artifact');
    const client = new DefaultArtifactClient();
    const r = await client.uploadArtifact('e2e-rapport', ['rapport.json'], repertoire);
    console.log('artifact publié:', JSON.stringify(r));
  } catch (e) {
    console.log('publication artifact impossible:', (e && e.message) || e);
  }
})();
