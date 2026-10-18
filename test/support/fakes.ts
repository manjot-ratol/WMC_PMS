/* In-memory fakes for application-service unit tests. Behaviourally faithful, no I/O. */
import type {
  AnalyticsEvent,
  AnalyticsPort,
} from '../../src/application/ports/analytics.port';
import type { ApplicationRepositoryPort } from '../../src/application/ports/application.repository.port';
import type {
  AuditEventInput,
  AuditPort,
} from '../../src/application/ports/audit.port';
import type { ChallengeRepositoryPort } from '../../src/application/ports/challenge.repository.port';
import type { CustomerRepositoryPort } from '../../src/application/ports/customer.repository.port';
import type {
  EligibilityDecisionRecord,
  EligibilityRepositoryPort,
} from '../../src/application/ports/eligibility.repository.port';
import type { KvStorePort } from '../../src/application/ports/kv-store.port';
import type {
  OutboxEventInput,
  OutboxPort,
} from '../../src/application/ports/outbox.port';
import type { RateLimiterPort } from '../../src/application/ports/rate-limiter.port';
import type {
  SessionRecord,
  SessionRepositoryPort,
} from '../../src/application/ports/session.repository.port';
import type {
  PreAuthBinding,
  PreAuthTokenStore,
  SessionData,
  SessionStore,
} from '../../src/application/ports/token-store.port';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../src/application/ports/unit-of-work.port';
import { StaleVersionError } from '../../src/common/errors/app-error';
import type {
  Challenge,
  ChallengeChannel,
} from '../../src/domain/identity/challenge';
import type { Customer } from '../../src/domain/identity/customer';
import type { OnboardingApplication } from '../../src/domain/onboarding/application';

export class FakeUow implements UnitOfWork {
  runs = 0;
  run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.runs++;
    return fn({} as TransactionContext);
  }
}

export class FakeKv implements KvStorePort {
  readonly data = new Map<string, { value: unknown; expiresAt: number }>();
  now = () => Date.now();
  private live(key: string) {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.data.set(key, {
      value: JSON.parse(JSON.stringify(value)) as unknown,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return Promise.resolve();
  }
  getJson<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.live(key)?.value as T) ?? null);
  }
  del(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
  getAndDelJson<T>(key: string): Promise<T | null> {
    const v = this.live(key)?.value as T | undefined;
    this.data.delete(key);
    return Promise.resolve(v ?? null);
  }
  incr(key: string): Promise<number> {
    const e = this.live(key);
    const next = ((e?.value as number) ?? 0) + 1;
    this.data.set(key, {
      value: next,
      expiresAt: e?.expiresAt ?? this.now() + 60_000,
    });
    return Promise.resolve(next);
  }
  ttl(key: string): Promise<number> {
    const e = this.live(key);
    return Promise.resolve(
      e ? Math.ceil((e.expiresAt - this.now()) / 1000) : -2,
    );
  }
}

export class FakeRateLimiter implements RateLimiterPort {
  readonly counts = new Map<string, number>();
  consume(
    scope: string,
    fingerprint: string,
    limit: number,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  }> {
    const k = `${scope}:${fingerprint}`;
    const n = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, n);
    return Promise.resolve(
      n <= limit
        ? { allowed: true, remaining: limit - n, retryAfterSeconds: 0 }
        : { allowed: false, remaining: 0, retryAfterSeconds: 30 },
    );
  }
}

export class FakeCustomers implements CustomerRepositoryPort {
  readonly rows = new Map<string, Customer>();
  constructor(private readonly fpOf: (phone: string) => string) {}
  findById(id: string): Promise<Customer | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  findByPhoneFingerprint(fp: string): Promise<Customer | null> {
    return Promise.resolve(
      [...this.rows.values()].find((c) => this.fpOf(c.phone) === fp) ?? null,
    );
  }
  create(c: Customer): Promise<void> {
    this.rows.set(c.id, c);
    return Promise.resolve();
  }
  saveWithVersionCheck(c: Customer, expectedVersion: number): Promise<void> {
    const cur = this.rows.get(c.id);
    if (!cur || cur.version !== expectedVersion)
      return Promise.reject(new StaleVersionError());
    this.rows.set(c.id, c);
    return Promise.resolve();
  }
}

export class FakeApplications implements ApplicationRepositoryPort {
  readonly rows = new Map<string, OnboardingApplication>();
  findById(id: string): Promise<OnboardingApplication | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  findInProgressByCustomer(
    customerId: string,
  ): Promise<OnboardingApplication | null> {
    return Promise.resolve(
      [...this.rows.values()].find(
        (a) => a.customerId === customerId && a.status === 'IN_PROGRESS',
      ) ?? null,
    );
  }
  listIdsByCustomer(customerId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((a) => a.customerId === customerId)
        .map((a) => a.id),
    );
  }
  create(app: OnboardingApplication): Promise<void> {
    this.rows.set(app.id, app);
    return Promise.resolve();
  }
  saveWithVersionCheck(
    app: OnboardingApplication,
    expectedVersion: number,
  ): Promise<void> {
    const cur = this.rows.get(app.id);
    if (!cur || cur.version !== expectedVersion)
      return Promise.reject(new StaleVersionError());
    this.rows.set(app.id, app);
    return Promise.resolve();
  }
}

export class FakeChallenges implements ChallengeRepositoryPort {
  readonly rows = new Map<string, Challenge>();
  create(c: Challenge): Promise<void> {
    this.rows.set(c.id, c);
    return Promise.resolve();
  }
  findById(id: string): Promise<Challenge | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  update(c: Challenge): Promise<void> {
    this.rows.set(c.id, c);
    return Promise.resolve();
  }
  findPendingByApplication(
    applicationId: string,
    channel: ChallengeChannel,
  ): Promise<Challenge[]> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (c) =>
          c.applicationId === applicationId &&
          c.channel === channel &&
          ['DISPATCH_PENDING', 'DISPATCHED', 'DISPATCH_FAILED'].includes(
            c.status,
          ),
      ),
    );
  }
}

export class FakeSessions implements SessionRepositoryPort {
  readonly rows: SessionRecord[] = [];
  create(s: SessionRecord): Promise<void> {
    this.rows.push(s);
    return Promise.resolve();
  }
  revoke(): Promise<void> {
    return Promise.resolve();
  }
}

export class FakeEligibility implements EligibilityRepositoryPort {
  readonly rows: EligibilityDecisionRecord[] = [];
  append(r: EligibilityDecisionRecord): Promise<void> {
    this.rows.push(r);
    return Promise.resolve();
  }
  latest(applicationId: string): Promise<EligibilityDecisionRecord | null> {
    return Promise.resolve(
      [...this.rows].reverse().find((r) => r.applicationId === applicationId) ??
        null,
    );
  }
}

export class FakeAudit implements AuditPort {
  readonly events: AuditEventInput[] = [];
  append(e: AuditEventInput): Promise<void> {
    this.events.push(e);
    return Promise.resolve();
  }
}
export class FakeOutbox implements OutboxPort {
  readonly events: OutboxEventInput[] = [];
  add(e: OutboxEventInput): Promise<string> {
    this.events.push(e);
    return Promise.resolve(`ob_${this.events.length}`);
  }
  claimBatch(): Promise<never[]> {
    return Promise.resolve([]);
  }
  markDispatched(): Promise<void> {
    return Promise.resolve();
  }
  markFailed(): Promise<void> {
    return Promise.resolve();
  }
}
export class FakeAnalytics implements AnalyticsPort {
  readonly events: AnalyticsEvent[] = [];
  track(e: AnalyticsEvent): Promise<void> {
    this.events.push(e);
    return Promise.resolve();
  }
}
export class FakePreAuth implements PreAuthTokenStore {
  readonly tokens = new Map<string, PreAuthBinding>();
  private n = 0;
  issue(b: PreAuthBinding): Promise<string> {
    const t = `preauth-token-${++this.n}`;
    this.tokens.set(t, b);
    return Promise.resolve(t);
  }
  resolve(t: string): Promise<PreAuthBinding | null> {
    return Promise.resolve(this.tokens.get(t) ?? null);
  }
  revoke(t: string): Promise<void> {
    this.tokens.delete(t);
    return Promise.resolve();
  }
}
export class FakeSessionStore implements SessionStore {
  readonly sessions = new Map<string, SessionData>();
  private n = 0;
  issue(d: SessionData): Promise<string> {
    const t = `session-token-${++this.n}`;
    this.sessions.set(t, d);
    return Promise.resolve(t);
  }
  resolve(t: string): Promise<SessionData | null> {
    return Promise.resolve(this.sessions.get(t) ?? null);
  }
  touch(): Promise<void> {
    return Promise.resolve();
  }
  update(t: string, d: SessionData): Promise<void> {
    this.sessions.set(t, d);
    return Promise.resolve();
  }
  revoke(t: string): Promise<void> {
    this.sessions.delete(t);
    return Promise.resolve();
  }
}

export class FixedClock {
  constructor(public current = new Date('2026-10-18T10:00:00Z')) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
export class SeqIds {
  private n = 0;
  uuid(): string {
    return `uuid-${++this.n}`;
  }
  prefixed(prefix: string): string {
    return `${prefix}_${++this.n}`;
  }
}
export const silentLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child(): unknown {
    return this;
  },
};
