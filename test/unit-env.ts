// Minimal environment for unit tests; values are not secrets.
process.env.NODE_ENV = 'test';
process.env.APP_ENV = process.env.APP_ENV ?? 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
