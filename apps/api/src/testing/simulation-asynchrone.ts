/**
 * Active le pilote de simulation ASYNCHRONE — à importer AVANT AppModule.
 *
 * Pourquoi un module et pas une affectation dans `beforeAll` : ConfigModule
 * valide l'environnement AU CHARGEMENT d'AppModule (les défauts zod sont
 * figés dans le cache du ConfigService). Un réglage posé dans `beforeAll`
 * arrive après la validation et n'est jamais vu — le pilote resterait
 * synchrone, et l'e2e croiserait les bras au lieu de tester le webhook.
 *
 * Retiré par le `afterAll` de la suite qui l'importe (le process.env
 * survit aux fichiers de test d'un même worker).
 */
process.env.PAYMENT_SIMULATION_ASYNC = 'true';
