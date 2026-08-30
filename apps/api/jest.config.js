module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',

  /**
   * Transpilation SANS type-vérification.
   *
   * Mesuré le 29 août 2026 : un test qui s'exécute en 6 secondes demandait
   * 179 secondes à la suite. L'écart n'était ni NestJS ni PostgreSQL — c'était
   * `ts-jest` qui reconstruisait et type-vérifiait tout le graphe TypeScript à
   * chaque exécution, via le LanguageService.
   *
   *   `isolatedModules` : chaque fichier est transpilé seul (`transpileModule`)
   *                       au lieu de passer par le LanguageService.
   *   `diagnostics`     : plus aucune erreur de typage remontée par Jest.
   *
   * Rien n'est perdu, et c'est la condition pour que ce réglage soit
   * légitime : `tsconfig.typecheck.json` inclut `src/**\/*`, donc les fichiers
   * de test SONT type-vérifiés — par `npm run typecheck`, dont c'est le
   * métier, et qui tourne dans la porte de qualité CI. Faire le travail deux
   * fois ne le faisait pas mieux, seulement plus lentement.
   *
   * Conséquence à connaître : une erreur de typage n'échoue plus au `jest`.
   * Elle échoue au `typecheck`. Lancer les deux reste la règle.
   *
   * `isolatedModules` est déprécié comme option ts-jest et disparaîtra en
   * v30 : il faudra alors le déplacer dans `tsconfig.json`. Il est gardé ici
   * pour ne pas durcir la compilation de production dans la foulée.
   */
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: 'tsconfig.json', isolatedModules: true, diagnostics: false },
    ],
  },

  collectCoverageFrom: ['src/**/*.ts'],
  moduleNameMapper: { '^@agrim/contracts$': '<rootDir>/../../packages/contracts/src/index.ts' },
  testEnvironment: 'node',
};
