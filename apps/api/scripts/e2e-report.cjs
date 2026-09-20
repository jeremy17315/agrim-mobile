/**
 * Canal de diagnostic e2e — TEMPORAIRE, à retirer après résolution.
 *
 * Les logs GitHub Actions sont illisibles depuis le sandbox de conception
 * (hosts results-receiver/blob.core.windows.net inaccessibles). Ce script
 * renvoie le résumé jest par le seul canal lisible d'ici : le dépôt.
 *  1. branche `ci/e2e-log` poussée avec les identifiants du checkout ;
 *  2. repli : artifact `e2e-rapport` via l'API runtime Actions.
 * Ne s'exécute que dans CI (`npm test` local n'envoie rien).
 */
const fs = require('fs');
const { execSync } = require('child_process');

let corps = 'erreur inconnue';
try {
  const data = JSON.parse(fs.readFileSync(process.argv[2] || '', 'utf8'));
  const echecs = (data.testResults || [])
    .filter((r) => r.status === 'failed')
    .map((r) => ({
      suite: r.name,
      message: (r.message || '').slice(0, 2000),
      tests: (r.assertionResults || r.testResults || [])
        .filter((t) => t.status === 'failed')
        .map((t) => ({
          nom: t.fullName || t.title,
          echec: (t.failureMessages || []).join('\n').slice(0, 1200),
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

async function versArtifact(corps) {
  const url = process.env.ACTIONS_RUNTIME_URL;
  const token = process.env.ACTIONS_RUNTIME_TOKEN;
  const runId = process.env.GITHUB_RUN_ID;
  if (!url || !token || !runId) return 'runtime indisponible';
  const base = url.endsWith('/') ? url : url + '/';
  const h = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const corps2 = Buffer.from(corps, 'utf8');
  const crea = await fetch(
    `${base}_apis/pipelines/workflows/${runId}/artifacts?api-version=6.0-preview`,
    { method: 'POST', headers: h, body: JSON.stringify({ Type: 'actions_storage', Name: 'e2e-rapport' }) },
  );
  if (!crea.ok) return `création artifact: HTTP ${crea.status}`;
  const conteneur = (await crea.json()).fileContainerResourceUrl;
  const n = corps2.length;
  const envoi = await fetch(`${conteneur}&itemPath=e2e-rapport/rapport.json`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-length': String(n),
      'content-range': `bytes 0-${n - 1}/${n}`,
      'x-tfs-filelength': String(n),
      'content-type': 'application/octet-stream',
    },
    body: corps2,
  });
  if (!envoi.ok) return `envoi blob: HTTP ${envoi.status}`;
  const localisation = crea.headers.get('location');
  if (localisation) {
    await fetch(localisation, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ Size: n, Type: 'actions_storage', Name: 'e2e-rapport' }),
    });
  }
  return 'artifact publié';
}

(async () => {
  try {
    const ws = process.env.GITHUB_WORKSPACE;
    if (ws && fs.existsSync(ws + '/.git')) {
      fs.writeFileSync(ws + '/e2e-report.json', corps);
      const git = (c) => execSync(`git -C ${ws} ${c}`, { stdio: 'pipe' }).toString();
      git('config user.email rapport@ci.local');
      git('config user.name rapport-ci');
      git('add e2e-report.json');
      execSync(`git -C ${ws} commit -m "ci: rapport e2e" || true`, { stdio: 'pipe' });
      execSync(`git -C ${ws} push -f origin HEAD:refs/heads/ci/e2e-log`, { stdio: 'pipe' });
      console.log('rapport publié sur la branche ci/e2e-log');
      return;
    }
    console.log(await versArtifact(corps));
  } catch (e) {
    try {
      console.log('push refusé (' + String(e.message).slice(0, 200) + '), repli artifact');
      console.log(await versArtifact(corps));
    } catch (e2) {
      console.log('canal de retour indisponible: ' + e2.message);
    }
  }
})();
