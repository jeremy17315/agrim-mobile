# AGRIM / Bélier d'Or — Refonte d'architecture

> Mission : concevoir l'architecture cible unifiée de l'écosystème AGRIM
> (Site Web, Back-Office, API centrale, Application Mobile Flutter), dans le
> respect du principe de **Source de Vérité Unique (SSOT)** et des contraintes
> d'infrastructure **LWS + cPanel**.
>
> Règle d'or : **aucune ligne de code avant la fin des livrables de conception.**

## Contraintes fondatrices (rappel)

1. **SSOT** : une seule base PostgreSQL, une seule API métier centrale pour
   Web, Back-Office et Mobile Flutter. Interdiction de toute synchronisation
   inter-systèmes.
2. **LWS + cPanel** : Passenger (Node.js) ou WSGI (Python). Pas de Railway,
   Supabase, Kubernetes, Docker, VPS sur-mesure, worker PM2 permanent ni n8n.
   Tâches planifiées = **Cron Jobs cPanel**.
3. **Stack** : Flutter (mobile) · NestJS ou FastAPI (backend) · PostgreSQL.
4. **Règles métier** : prix/stock/montants calculés côté serveur uniquement ;
   transactions + verrouillage pour le stock ; CinetPay isolé avec webhooks
   idempotents authentifiés ; OTP livraison 4 chiffres généré serveur ;
   notifications découplées ; clés d'idempotence sur les opérations sensibles.
5. **RBAC** : `CLIENT`, `LIVREUR`, `PRODUCTEUR`, `GESTIONNAIRE`, `ADMIN`, `DG`.

## Livrables

| # | Livrable | Document | Statut |
| --- | --- | --- | --- |
| 0 | Index de la conception | `README.md` (ce fichier) | ✅ |
| 1 | Audit du dépôt existant `agrim-mobile` | `00-audit-depot-existant.md` | ✅ |
| 2 | Diagramme d'architecture globale | `01-architecture-cible.md` | ✅ |
| 3 | Architecture logicielle backend (modules) | `02-backend-modules.md` | ✅ |
| 4 | Modèle de données cible (ERD PostgreSQL) | `03-modele-donnees.md` | ✅ |
| 5 | Contrats d'API v1 `/api/v1` | `04-contrats-api.md` | ✅ |
| 6 | Architecture du module CinetPay | `05-module-cinetpay.md` | ✅ |
| 7 | Workflow Livraison & OTP | `06-workflow-livraison-otp.md` | ✅ |
| 8 | Procédure de déploiement LWS / cPanel | `07-deploiement-lws-cpanel.md` | ✅ |
| 9 | Stratégie de migration des données | `08-migration-donnees.md` | ⏳ |
| 10 | Plan de tests complet | `09-plan-de-tests.md` | ⏳ |

## Rapport avec la documentation historique

Les documents de `docs/` (ARCHITECTURE.md, AUDIT-FOUNDATIONS.md, etc.)
décrivent l'architecture **actuelle à deux systèmes**, dont la trajectoire
retenue (« le site possède le stock et le catalogue, jamais de base partagée »)
est **invalidée par la présente mission**, qui impose une API centrale unique.
Ces documents restent la **spécification fonctionnelle de référence** : les
règles métier, machines à états et flux qu'ils décrivent sont repris dans la
conception cible, mais leur répartition en deux logiciels ne l'est pas.
