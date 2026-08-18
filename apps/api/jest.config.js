module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  collectCoverageFrom: ['src/**/*.ts'],
  moduleNameMapper: { '^@agrim/contracts$': '<rootDir>/../../packages/contracts/src/index.ts' },
  testEnvironment: 'node',
};
