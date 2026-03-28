module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  roots: ['<rootDir>/api', '<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.js'],
  testPathIgnorePatterns: ['<rootDir>/e2e/', '<rootDir>/node_modules/'],
  modulePathIgnorePatterns: ['<rootDir>/dist-web/'],
  clearMocks: true,
  restoreMocks: true
};
