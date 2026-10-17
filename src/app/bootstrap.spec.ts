import type { INestApplication } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types';
import { describeWithDb, loadTestEnv } from '../../test/support/db';
import { LOGGER_OPTIONS } from '../common/logging/logger.service';
import { createApiApp } from './bootstrap';

interface Envelope {
  error: { code: string; message: string; retryable: boolean };
  request_id: string;
}
interface OpenApiDoc {
  openapi: string;
  components: { securitySchemes: Record<string, unknown> };
  paths: Record<string, { get: { parameters: { name: string }[] } }>;
}

describeWithDb('API bootstrap (docker infra)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    loadTestEnv();
    process.env.ENV_FILE = '.env.test';
    app = (await createApiApp()) as INestApplication<App>;
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /health is 200 and echoes a supplied correlation id', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('X-Correlation-ID', 'abc-123')
      .expect(200);
    expect(res.headers['x-correlation-id']).toBe('abc-123');
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /health/ready is 200 against live infra', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect((res.body as { checks: unknown }).checks).toEqual({
      postgres: 'ok',
      redis: 'ok',
    });
  });

  it('unknown route returns the error envelope with request_id = generated correlation id', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    const body = res.body as Envelope;
    expect(body.error).toEqual({
      code: 'NOT_FOUND',
      message: expect.any(String) as string,
      retryable: false,
    });
    expect(body.request_id).toBe(res.headers['x-correlation-id']);
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves swagger json with both security schemes and the global correlation header', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const doc = res.body as OpenApiDoc;
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual([
      'internalToken',
      'session',
    ]);
    const params = doc.paths['/health'].get.parameters;
    expect(params.some((p) => p.name === 'X-Correlation-ID')).toBe(true);
  });

  it('supports provider overrides for tests (captures logs)', async () => {
    const lines: string[] = [];
    const stream = new PassThrough();
    stream.on('data', (c: Buffer) => lines.push(c.toString('utf8')));
    const other = (await createApiApp({
      overrides: (b) =>
        b.overrideProvider(LOGGER_OPTIONS).useValue({
          level: 'info',
          serviceName: 'ovr',
          pretty: false,
          stream,
        }),
    })) as INestApplication<App>;
    await other.init();
    await request(other.getHttpServer())
      .get('/health')
      .set('X-Correlation-ID', 'ovr-1')
      .expect(200);
    await other.close();
    expect(lines.join('')).toContain('"correlationId":"ovr-1"');
  });

  it('sets security headers via helmet', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
