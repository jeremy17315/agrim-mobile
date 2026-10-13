# Tâches planifiées sous cPanel — API `api.agrimsarl.ci`

L'API tourne sous Passenger (cPanel/LWS) : le processus peut dormir ou être
recyclé. **Un `setInterval` n'est donc pas fiable** : les tâches importantes
sont déclenchées par des **tâches cron cPanel** qui appellent l'API en HTTP.

## Lignes à créer (cPanel → Tâches cron)

Remplacer `CHANGEZ_MOI` par la valeur réelle de `CRON_SECRET` (dans le fichier
d'environnement de l'application, jamais dans ce document ni dans Git).

| Fréquence | Commande |
| --- | --- |
| Toutes les 5 min | `curl -fsS -X POST -H "X-Cron-Secret: CHANGEZ_MOI" https://api.agrimsarl.ci/api/v1/jobs/run/catalog-sync >/dev/null` |
| Toutes les 5 min | `curl -fsS -X POST -H "X-Cron-Secret: CHANGEZ_MOI" https://api.agrimsarl.ci/api/v1/jobs/run/outbox-drain >/dev/null` |
| Toutes les heures | `curl -fsS -X POST -H "X-Cron-Secret: CHANGEZ_MOI" https://api.agrimsarl.ci/api/v1/jobs/run/reconciliation >/dev/null` |

Réponses : `200` (exécuté), `409 JOB_ALREADY_RUNNING` (normal : une exécution
est déjà en cours), `401` (secret faux), `503` (`CRON_SECRET` absent : tout est
refusé, c'est voulu).

Vérifier les tâches disponibles :

    curl -s https://api.agrimsarl.ci/api/v1/jobs

## Déclenchement immédiat par le site

Dès qu'AGRIM enregistre un produit, un prix ou une photo, le site appelle :

    curl -fsS -X POST -H "X-Integration-Token: CHANGEZ_MOI" https://api.agrimsarl.ci/api/v1/integration/catalogue-changed

- Jeton : la même valeur que `SITE_INTEGRATION_TOKEN` (côté API) — `RB_SYNC_TOKEN`
  côté site, à faire correspondre.
- Réponse `202 {"accepted": true}` immédiate ; la recopie se fait en arrière-plan.
- `503` : jeton non configuré côté API. `401` : jeton différent.

## Ce qui n'est pas dans ce document

- Les valeurs réelles des secrets : elles restent dans le fichier d'environnement.
- L'URL réelle du site : `https://agrimsarl.ci/belier`, à confirmer par AGRIM.
