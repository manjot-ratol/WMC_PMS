import type { INestApplication } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createApiApp } from '../../../src/app/bootstrap';
import {
  AppLogger,
  LOGGER_OPTIONS,
} from '../../../src/common/logging/logger.service';
import { loadTestEnv } from '../../support/env';

export interface SitApp {
  app: INestApplication<App>;
  http: () => ReturnType<typeof request>;
  /** JSON log lines captured from the app logger. */
  logs: Record<string, unknown>[];
  stop: () => Promise<void>;
}

/** Boots the real API (same bootstrap as production) against docker infra, capturing logs. */
export async function startSitApp(): Promise<SitApp> {
  loadTestEnv();
  process.env.ENV_FILE = '.env.test';
  process.env.LOG_LEVEL = 'info';
  const logs: Record<string, unknown>[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) logs.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const app = (await createApiApp({
    overrides: (builder) =>
      builder
        .overrideProvider(LOGGER_OPTIONS)
        .useValue({ level: 'info', serviceName: 'sit', pretty: false, stream }),
  })) as INestApplication<App>;
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    logs,
    stop: () => app.close(),
  };
}

export { AppLogger };
