/**
 * Tests du contrat partagé.
 *
 * Ce paquet n'était ni testé ni linté : dépourvu de script `test`, il était
 * SILENCIEUSEMENT ignoré par le `npm test --workspaces --if-present` de la
 * racine. C'est pourtant lui qui porte le calcul de l'argent et les machines
 * à états que le mobile et l'API appliquent tous les deux — la pièce qui
 * mériterait la couverture la plus stricte était la seule sans filet.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
};
