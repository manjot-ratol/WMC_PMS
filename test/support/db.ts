export { loadTestEnv, migrateTestDb } from './env';

export const describeWithDb = process.env.SKIP_DB_TESTS
  ? describe.skip
  : describe;
