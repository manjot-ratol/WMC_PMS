import { HealthController } from './health.controller';

describe('HealthController', () => {
  const res = () => {
    const r = { status: jest.fn(), json: jest.fn() };
    r.status.mockReturnValue(r);
    return r;
  };

  it('live returns service and version', () => {
    const c = new HealthController(
      { serviceName: 'svc' },
      { ping: jest.fn() },
      { ping: jest.fn() },
    );
    expect(c.live()).toMatchObject({ status: 'ok', service: 'svc' });
    expect(typeof c.live().version).toBe('string');
  });

  it('ready is 200 when both dependencies answer', async () => {
    const c = new HealthController(
      { serviceName: 'svc' },
      { ping: jest.fn().mockResolvedValue(true) } as never,
      { ping: jest.fn().mockResolvedValue(true) } as never,
    );
    const r = res();
    await c.ready(r as never);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith({
      status: 'ok',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('ready is 503 when a dependency answers false', async () => {
    const c = new HealthController(
      { serviceName: 'svc' },
      { ping: jest.fn().mockResolvedValue(false) } as never,
      { ping: jest.fn().mockResolvedValue(true) } as never,
    );
    const r = res();
    await c.ready(r as never);
    expect(r.status).toHaveBeenCalledWith(503);
  });

  it('ready is 503 with per-dependency status when redis rejects', async () => {
    const c = new HealthController(
      { serviceName: 'svc' },
      { ping: jest.fn().mockResolvedValue(true) } as never,
      { ping: jest.fn().mockRejectedValue(new Error('down')) } as never,
    );
    const r = res();
    await c.ready(r as never);
    expect(r.status).toHaveBeenCalledWith(503);
    expect(r.json).toHaveBeenCalledWith({
      status: 'degraded',
      checks: { postgres: 'ok', redis: 'fail' },
    });
  });
});
