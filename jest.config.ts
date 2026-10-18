import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.module.ts',
    '!src/**/*.types.ts',
    '!src/**/index.ts',
    '!src/app/main.ts',
    '!src/app/worker.ts',
    '!src/app/trackwizz-mock.ts',
    '!src/infrastructure/partners/trackwizz/trackwizz-mock.server.ts',
    '!src/generated/**',
  ],
  coverageDirectory: 'coverage',
  // Branches are gated at 85 rather than 90: with emitDecoratorMetadata, every injected class imported from
  // another module compiles to `typeof (_a = typeof X !== "undefined" && X) === "function" ? _a : Object`,
  // one branch of which can never execute. Lines, functions and statements stay at 90.
  coverageThreshold: {
    global: { lines: 90, branches: 85, functions: 90, statements: 90 },
  },
  setupFiles: ['<rootDir>/test/unit-env.ts'],
};

export default config;
