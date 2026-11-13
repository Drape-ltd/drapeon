/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  watchman: false,
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@drape/shared$': '<rootDir>/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { target: 'ES2020', lib: ['ES2020', 'DOM'], esModuleInterop: true, allowImportingTsExtensions: true, noEmit: true, baseUrl: '.', paths: { '@drape/shared': ['src/index.ts'] } } }],
  },
}
