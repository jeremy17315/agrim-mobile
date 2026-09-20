/**
 * Canal de diagnostic e2e — TEMPORAIRE, à retirer après résolution.
 *
 * Les logs GitHub Actions sont illisibles depuis le sandbox. Le retour se
 * fait par les commandes `::error::` — GitHub les convertit en annotations
 * du check-run, lisibles via l'API même quand les logs restent bloqués.
 * Ne s'exécute que dans CI (npm test local n'émet rien).
 */
const fs = require('fs');
const path = require('path');

let resume = { erreur: 'aucun résultat' };
let tests = [];
try {
  const data = JSON.parse(fs.readFileSync(process.argv[2] || '', 'utf8'));
  resume = {
    total: data.numTotalTests,
    passes: data.numPassedTests,
    echoues: data.numFailedTests,
    suitesEnErreur: data.numRuntimeErrorTestSuites,
  };
  for (const r of data.testResults || []) {
    if (r.status !== 'failed') continue;
    const fichier = r.name.replace(/^.*src\//, 'src/');
    for (const t of r.assertionResults || r.testResults || []) {
      if (t.status !== 'failed') continue;
      tests.push({
        fichier,
        nom: t.fullName || t.title,
        msg: (t.failureMessages || []).join(' | ').slice(0, 430),
      });
    }
    if ((r.testResults || []).every((t) => t.status !== 'failed')) {
      tests.push({ fichier, nom: '(suite en échec de chargement)', msg: (r.message || '').slice(0, 320) });
    }
  }
} catch (e) {
  resume = { erreur: 'aucun fichier de résultats jest: ' + e.message };
}

const escape = (l) => l.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
console.log('::error::' + escape(`RESUME e2e: ${JSON.stringify(resume)}`));
for (const t of tests.slice(0, 8)) {
  console.log('::error::' + escape(`TEST ${t.fichier} :: ${t.nom} :: ${t.msg}`));
}
if (tests.length > 8) console.log('::error::' + escape(`(+${tests.length - 8} autres échecs non listés)`));

// Diagnostic de l'artifact (pourquoi le canal détaillé ne sort pas).
const envFlags = {
  runtimeToken: !!process.env.ACTIONS_RUNTIME_TOKEN,
  resultsUrl: !!process.env.ACTIONS_RESULTS_URL,
  runtimeUrl: !!process.env.ACTIONS_RUNTIME_URL,
  runId: !!process.env.GITHUB_RUN_ID,
};
(async () => {
  try {
    // @actions/artifact est ESM-only: import() dynamique obligatoire depuis CJS.
    const { DefaultArtifactClient } = await import('@actions/artifact');
    const client = new DefaultArtifactClient();
    const repertoire = '/tmp/e2e-rapport';
    fs.mkdirSync(repertoire, { recursive: true });
    const fichier = path.join(repertoire, 'rapport.json');
    fs.writeFileSync(fichier, JSON.stringify({ resume, tests }, null, 2));
    // v2 du client: chemins de fichiers ABSOLUS.
    const r = await client.uploadArtifact('e2e-rapport', [fichier], repertoire);
    console.log('artifact publié:', JSON.stringify(r));
  } catch (e) {
    console.log('::error::' + escape(`ARTIFACT FAIL: ${(e && e.message) || e} | env=${JSON.stringify(envFlags)}`));
  }
})();
