// @ts-check
import { defineConfig } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

export default defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', '.expo/**', 'node_modules/**', 'expo-env.d.ts'],
  },
  {
    rules: {
      // Le contrat partagé et les schémas Zod rendent `any` évitable partout.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      // Aucun log parasite dans un bundle expédié.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Jest hisse `jest.mock` au-dessus des imports : certains modules doivent
    // etre requis apres coup pour observer le mock. Contrainte de l'outil, pas
    // negligence de style.
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.js'],
    rules: {
      'no-console': 'off',
      'import/first': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
