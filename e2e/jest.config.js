module.exports = {
  rootDir: '..',
  testTimeout: 180000,
  maxWorkers: 1,
  testMatch: ['<rootDir>/e2e/**/*.e2e.js'],
  reporters: ['detox/runners/jest/reporter'],
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  testEnvironment: 'detox/runners/jest/testEnvironment',
  setupFilesAfterEnv: ['<rootDir>/e2e/init.js']
};
