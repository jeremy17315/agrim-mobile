// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Le contrat partagé n'avait ni `test` ni `lint`. Comme la racine invoque
 * `--if-present`, il était SILENCIEUSEMENT sauté par les deux portes de
 * qualité — alors qu'il porte le calcul de l'argent et les machines à états
 * appliquées des deux côtés.
 *
 * Configuration alignée sur celle de l'API, à une exception près : pas de
 * règle `no-console`. Ce paquet ne contient aucun point d'entrée exécutable,
 * un `console` y serait de toute façon du code mort.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
);
