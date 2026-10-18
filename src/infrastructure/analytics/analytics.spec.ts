import nock from 'nock';
import { silentLogger } from '../../../test/support/fakes';
import {
  ANALYTICS_PROPERTY_ALLOWLIST,
  type AnalyticsOutboxPort,
  type AnalyticsOutboxRow,
  type AnalyticsSinkPort,
} from '../../application/ports/analytics-outbox.port';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { DependencyUnavailableError } from '../../common/errors/app-error';
import { CircuitBreakerRegistry } from '../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../common/http/http-client.service';
import { AnalyticsDispatcherProcessor } from './analytics-dispatcher.processor';
import { CleverTapGateway } from './clevertap.gateway';
import { LogAnalyticsSink } from './log-analytics.sink';

class FakeAnalyticsOutbox implements AnalyticsOutboxPort {
  rows: AnalyticsOutboxRow[] = [];
  dispatched: string[] = [];
  failed: { id: string; error: string }[] = [];
  dead: { id: string; reason: string }[] = [];
  claimUndispatched(limit: number): Promise<AnalyticsOutboxRow[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (r) =>
            !this.dispatched.includes(r.id) &&
            !this.dead.some((d) => d.id === r.id),
        )
        .slice(0, limit),
    );
  }
  markDispatched(ids: string[]): Promise<void> {
    this.dispatched.push(...ids);
    return Promise.resolve();
  }
  markFailed(id: string, error: string): Promise<void> {
    this.failed.push({ id, error });
    return Promise.resolve();
  }
  markDead(id: string, reason: string): Promise<void> {
    this.dead.push({ id, reason });
    return Promise.resolve();
  }
}
const row = (
  id: string,
  props: Record<string, unknown>,
  identity?: string,
): AnalyticsOutboxRow => ({
  id,
  eventName: 'Phone Verification Completed',
  identity,
  properties: {
    event_id: `evt_${id}`,
    application_id: 'app_1',
    screen_id: '02',
    outcome: 'verified',
    ...props,
  },
  createdAt: new Date('2026-10-18T00:00:00Z'),
  attempts: 0,
});
const cfg = {
  clevertap: {
    enabled: true,
    baseUrl: 'http://ct.test',
    accountId: 'ACC',
    passcode: 'PASS',
    timeoutMs: 2000,
  },
} as never;

describe('AnalyticsDispatcherProcessor', () => {
  const logger = {
    ...silentLogger,
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    child() {
      return this;
    },
  } as never;
  it('uploads allowlisted properties, strips anything else as a privacy incident, and honours the sink verdict', async () => {
    const outbox = new FakeAnalyticsOutbox();
    outbox.rows = [
      row('a', {}, 'cus_1'),
      row('b', { pan: 'ABCPE1234F' }),
      row('c', {}, 'cus_1'),
    ];
    const sink: AnalyticsSinkPort = {
      upload: jest.fn().mockImplementation(
        (
          events: {
            id: string;
            event: {
              evtData: Record<string, unknown>;
              identity?: string;
              objectId?: string;
            };
          }[],
        ) =>
          Promise.resolve({
            accepted: events.filter((e) => e.id !== 'c').map((e) => e.id),
            rejected: [{ id: 'c', error: 'Malformed event' }],
          }),
      ),
    };
    const p = new AnalyticsDispatcherProcessor(
      new CorrelationStore(),
      logger,
      outbox,
      sink,
    );
    const r = await p.handle({ limit: 10 });
    expect(r).toEqual({ claimed: 3, dispatched: 2, failed: 1, stripped: 1 });
    const sent = jest.mocked(sink).upload.mock.calls[0][0];
    expect(sent[1].event.evtData).not.toHaveProperty('pan');
    expect(sent[1].event).toMatchObject({ objectId: 'app_1', ts: 1792281600 });
    expect(sent[0].event).toMatchObject({ identity: 'cus_1' });
    expect(outbox.dispatched).toEqual(['a', 'b']);
    expect(outbox.dead).toEqual([
      { id: 'c', reason: 'rejected by sink: Malformed event' },
    ]);
    expect((logger as { error: jest.Mock }).error).toHaveBeenCalledWith(
      'analytics.privacy_incident',
      expect.objectContaining({ property: 'pan' }),
    );
    expect(await p.handle({ limit: 10 })).toEqual({
      claimed: 0,
      dispatched: 0,
      failed: 0,
      stripped: 0,
    });
  });
  it('a sink outage marks every claimed row failed for retry', async () => {
    const outbox = new FakeAnalyticsOutbox();
    outbox.rows = [row('a', {})];
    const p = new AnalyticsDispatcherProcessor(
      new CorrelationStore(),
      logger,
      outbox,
      { upload: () => Promise.reject(new DependencyUnavailableError()) },
    );
    expect(await p.handle({ limit: 10 })).toMatchObject({
      failed: 1,
      dispatched: 0,
    });
    expect(outbox.failed).toHaveLength(1);
    const q = new AnalyticsDispatcherProcessor(
      new CorrelationStore(),
      logger,
      outbox,
      { upload: () => Promise.reject(new Error('boom')) },
    );
    expect(await q.handle({ limit: 10 })).toMatchObject({ failed: 1 });
  });
  it('the write-side allowlist and the dispatcher allowlist agree', () => {
    expect([...ANALYTICS_PROPERTY_ALLOWLIST]).toEqual(
      expect.arrayContaining([
        'event_id',
        'application_id',
        'screen_id',
        'journey_version',
        'event_schema_version',
        'event_source',
        'outcome',
        'safe_error_category',
        'attempt_number',
      ]),
    );
    for (const denied of [
      'pan',
      'phone',
      'email',
      'otp',
      'account_number',
      'risk_value',
      'pep',
      'token',
      'aadhaar',
      'tin',
      'hash',
    ])
      expect(ANALYTICS_PROPERTY_ALLOWLIST).not.toContain(denied);
  });
});

describe('CleverTapGateway and LogAnalyticsSink', () => {
  afterEach(() => nock.cleanAll());
  const gw = () =>
    new CleverTapGateway(
      new HttpClientService(
        new CorrelationStore(),
        silentLogger as never,
        new CircuitBreakerRegistry(),
      ),
      cfg,
    );
  const ev = (id: string, evtId: string) => ({
    id,
    event: {
      identity: 'cus_1',
      evtName: 'E',
      ts: 1,
      evtData: { event_id: evtId },
    },
  });
  it('posts the documented payload with account headers and maps unprocessed records by event id', async () => {
    let body: { d: Record<string, unknown>[] } | undefined;
    nock('http://ct.test')
      .post('/1/upload', (b: { d: Record<string, unknown>[] }) => {
        body = b;
        return true;
      })
      .matchHeader('X-CleverTap-Account-Id', 'ACC')
      .matchHeader('X-CleverTap-Passcode', 'PASS')
      .reply(200, {
        status: 'partial',
        processed: 2,
        unprocessed: [
          {
            status: 'fail',
            code: 512,
            error: 'Event name too long',
            record: { evtData: { event_id: 'e2' } },
          },
        ],
      });
    const r = await gw().upload([ev('1', 'e1'), ev('2', 'e2'), ev('3', 'e3')]);
    expect(body!.d[0]).toEqual({
      identity: 'cus_1',
      type: 'event',
      evtName: 'E',
      ts: 1,
      evtData: { event_id: 'e1' },
    });
    expect(r).toEqual({
      accepted: ['1', '3'],
      rejected: [{ id: '2', error: 'Event name too long' }],
    });
    nock('http://ct.test')
      .post('/1/upload')
      .reply(200, {
        status: 'success',
        processed: 1,
        unprocessed: [{ code: 1, record: { __index: 0 } }],
      });
    expect(
      await gw().upload([
        {
          id: 'x',
          event: { objectId: 'app_1', evtName: 'E', ts: 1, evtData: {} },
        },
      ]),
    ).toEqual({ accepted: [], rejected: [{ id: 'x', error: 'code 1' }] });
  });
  it('batches 100 per request; 4xx is a rejection, 5xx an outage', async () => {
    const calls: number[] = [];
    nock('http://ct.test')
      .post('/1/upload', (b: { d: unknown[] }) => {
        calls.push(b.d.length);
        return true;
      })
      .times(2)
      .reply(200, { status: 'success' });
    const many = Array.from({ length: 150 }, (_, i) => ev(String(i), `e${i}`));
    expect((await gw().upload(many)).accepted).toHaveLength(150);
    expect(calls).toEqual([100, 50]);
    nock('http://ct.test')
      .post('/1/upload')
      .reply(401, { status: 'fail', error: 'Invalid passcode' });
    await expect(gw().upload([ev('1', 'e1')])).rejects.toMatchObject({
      code: 'PARTNER_REJECTED',
    });
    nock('http://ct.test').post('/1/upload').reply(503, {});
    await expect(gw().upload([ev('1', 'e1')])).rejects.toMatchObject({
      code: 'VERIFICATION_UNAVAILABLE',
    });
  });
  it('the log sink accepts everything and logs names only', async () => {
    const info = jest.fn();
    const sink = new LogAnalyticsSink({ child: () => ({ info }) } as never);
    expect(await sink.upload([ev('1', 'e1'), ev('2', 'e2')])).toEqual({
      accepted: ['1', '2'],
      rejected: [],
    });
    expect(info).toHaveBeenCalledWith('analytics.local_sink', {
      events: { E: 2 },
      total: 2,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('cus_1');
  });
});
