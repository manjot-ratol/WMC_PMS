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
  markDead(): Promise<void> {
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

/* ---------- Phase 3 fakes ---------- */
import type { IdentityRepositoryPort } from '../../src/application/ports/identity.repository.port';
import type {
  KycRecordRepositoryPort,
  KycSessionRepositoryPort,
} from '../../src/application/ports/kyc.repository.port';
import type { DocumentRepositoryPort } from '../../src/application/ports/document.repository.port';
import type {
  TaskRecord,
  TaskRepositoryPort,
  TaskResponseRecord,
  VerificationRepositoryPort,
} from '../../src/application/ports/verification.repository.port';
import type {
  ObjectStoragePort,
  StoredObjectInfo,
} from '../../src/application/ports/object-storage.port';
import type {
  JobPublisherPort,
  PublishOptions,
} from '../../src/application/ports/job-publisher.port';
import type {
  InboxPort,
  InboxRow,
} from '../../src/application/ports/inbox.port';
import type { IdentityVersion } from '../../src/domain/kyc/identity-version';
import type { KycRecord } from '../../src/domain/kyc/kyc-record';
import type { KycSession } from '../../src/domain/kyc/kyc-session';
import type {
  Document,
  DocumentUpload,
} from '../../src/domain/documents/document';
import type { AdditionalVerification } from '../../src/domain/ipv/additional-verification';

export class FakeIdentities implements IdentityRepositoryPort {
  readonly rows: IdentityVersion[] = [];
  constructor(private readonly fpOf: (pan: string) => string) {}
  append(i: IdentityVersion): Promise<void> {
    this.rows.push(i);
    return Promise.resolve();
  }
  latest(applicationId: string): Promise<IdentityVersion | null> {
    return Promise.resolve(
      [...this.rows].reverse().find((r) => r.applicationId === applicationId) ??
        null,
    );
  }
  otherApplicationsWithPan(fp: string, except: string): Promise<string[]> {
    return Promise.resolve([
      ...new Set(
        this.rows
          .filter((r) => this.fpOf(r.pan) === fp && r.applicationId !== except)
          .map((r) => r.applicationId),
      ),
    ]);
  }
}
export class FakeKycRecords implements KycRecordRepositoryPort {
  readonly rows = new Map<string, KycRecord>();
  create(r: KycRecord): Promise<void> {
    this.rows.set(r.id, r);
    return Promise.resolve();
  }
  findById(id: string): Promise<KycRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  latestForApplication(applicationId: string): Promise<KycRecord | null> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.applicationId === applicationId)
        .sort((a, b) => b.identityVersion - a.identityVersion)[0] ?? null,
    );
  }
  saveWithVersionCheck(r: KycRecord, expected: number): Promise<void> {
    const cur = this.rows.get(r.id);
    if (!cur || cur.version !== expected)
      return Promise.reject(new StaleVersionError());
    this.rows.set(r.id, r);
    return Promise.resolve();
  }
}
export class FakeKycSessions implements KycSessionRepositoryPort {
  readonly rows = new Map<string, KycSession>();
  create(s: KycSession): Promise<void> {
    this.rows.set(s.id, s);
    return Promise.resolve();
  }
  findById(id: string): Promise<KycSession | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  findByProviderRequestId(pid: string): Promise<KycSession | null> {
    return Promise.resolve(
      [...this.rows.values()].find((s) => s.providerRequestId === pid) ?? null,
    );
  }
  latestForApplication(applicationId: string): Promise<KycSession | null> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((s) => s.applicationId === applicationId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
        null,
    );
  }
  update(s: KycSession): Promise<void> {
    this.rows.set(s.id, s);
    return Promise.resolve();
  }
}
export class FakeDocuments implements DocumentRepositoryPort {
  readonly uploads = new Map<string, DocumentUpload>();
  readonly docs = new Map<string, Document>();
  createUpload(u: DocumentUpload): Promise<void> {
    this.uploads.set(u.id, u);
    return Promise.resolve();
  }
  findUpload(id: string): Promise<DocumentUpload | null> {
    return Promise.resolve(this.uploads.get(id) ?? null);
  }
  updateUpload(u: DocumentUpload): Promise<void> {
    this.uploads.set(u.id, u);
    return Promise.resolve();
  }
  createDocument(d: Document): Promise<void> {
    this.docs.set(d.id, d);
    return Promise.resolve();
  }
  findDocument(id: string): Promise<Document | null> {
    return Promise.resolve(this.docs.get(id) ?? null);
  }
  updateDocument(d: Document): Promise<void> {
    this.docs.set(d.id, d);
    return Promise.resolve();
  }
  latestVerified(
    applicationId: string,
    requirementId: string,
  ): Promise<Document | null> {
    return Promise.resolve(
      [...this.docs.values()]
        .reverse()
        .find(
          (d) =>
            d.applicationId === applicationId &&
            d.requirementId === requirementId &&
            d.status === 'VERIFIED',
        ) ?? null,
    );
  }
}
export class FakeVerifications implements VerificationRepositoryPort {
  readonly rows = new Map<string, AdditionalVerification>();
  create(v: AdditionalVerification): Promise<void> {
    this.rows.set(v.id, v);
    return Promise.resolve();
  }
  findById(id: string): Promise<AdditionalVerification | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  latestForApplication(
    applicationId: string,
  ): Promise<AdditionalVerification | null> {
    return Promise.resolve(
      [...this.rows.values()]
        .reverse()
        .find((v) => v.applicationId === applicationId) ?? null,
    );
  }
  update(v: AdditionalVerification): Promise<void> {
    this.rows.set(v.id, v);
    return Promise.resolve();
  }
  countByType(
    applicationId: string,
    type: AdditionalVerification['type'],
  ): Promise<number> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (v) => v.applicationId === applicationId && v.type === type,
      ).length,
    );
  }
}
export class FakeTasks implements TaskRepositoryPort {
  readonly rows: TaskRecord[] = [];
  readonly responses: TaskResponseRecord[] = [];
  create(t: TaskRecord): Promise<void> {
    this.rows.push(t);
    return Promise.resolve();
  }
  findById(id: string): Promise<TaskRecord | null> {
    return Promise.resolve(this.rows.find((t) => t.id === id) ?? null);
  }
  update(t: TaskRecord): Promise<void> {
    const i = this.rows.findIndex((x) => x.id === t.id);
    if (i >= 0) this.rows[i] = t;
    return Promise.resolve();
  }
  createResponse(r: TaskResponseRecord): Promise<void> {
    this.responses.push(r);
    return Promise.resolve();
  }
  listOpen(applicationId: string): Promise<TaskRecord[]> {
    return Promise.resolve(
      this.rows.filter(
        (t) => t.applicationId === applicationId && t.status !== 'RESOLVED',
      ),
    );
  }
}
export class FakeStorage implements ObjectStoragePort {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  presignPut(key: string, contentType: string): Promise<string> {
    return Promise.resolve(
      `https://storage.test/${key}?ct=${encodeURIComponent(contentType)}`,
    );
  }
  head(key: string): Promise<StoredObjectInfo | null> {
    const o = this.objects.get(key);
    return Promise.resolve(
      o ? { sizeBytes: o.body.length, contentType: o.contentType } : null,
    );
  }
  get(key: string): Promise<Buffer> {
    return Promise.resolve(this.objects.get(key)?.body ?? Buffer.alloc(0));
  }
  put(key: string, body: Buffer | string, contentType: string): Promise<void> {
    this.objects.set(key, {
      body: Buffer.isBuffer(body) ? body : Buffer.from(body),
      contentType,
    });
    return Promise.resolve();
  }
}
export class FakeJobs implements JobPublisherPort {
  readonly published: {
    queue: string;
    name: string;
    payload: unknown;
    opts?: PublishOptions;
  }[] = [];
  publish<T>(
    queue: string,
    name: string,
    payload: T,
    opts?: PublishOptions,
  ): Promise<void> {
    this.published.push({ queue, name, payload, opts });
    return Promise.resolve();
  }
}
export class FakeInbox implements InboxPort {
  readonly rows = new Map<string, InboxRow>();
  private n = 0;
  insertIfNew(
    provider: string,
    eventKey: string,
    payload: unknown,
  ): Promise<{ inserted: boolean; id: string }> {
    const existing = [...this.rows.values()].find(
      (r) => r.provider === provider && r.eventKey === eventKey,
    );
    if (existing) return Promise.resolve({ inserted: false, id: existing.id });
    const id = `inbox_${++this.n}`;
    this.rows.set(id, { id, provider, eventKey, payload, status: 'RECEIVED' });
    return Promise.resolve({ inserted: true, id });
  }
  get(id: string): Promise<InboxRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  markProcessed(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.status = 'PROCESSED';
    return Promise.resolve();
  }
  markFailed(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.status = 'FAILED';
    return Promise.resolve();
  }
}

/* ---------- Phase 4 fakes ---------- */
import type { BankRepositoryPort } from '../../src/application/ports/bank.repository.port';
import type {
  AmlAssessmentRecord,
  ComplianceCaseRecord,
  ComplianceRepositoryPort,
  ReviewDecisionRecord,
  ScreeningRunRecord,
} from '../../src/application/ports/compliance.repository.port';
import type { NominationRepositoryPort } from '../../src/application/ports/nomination.repository.port';
import type {
  DeclarationsRepositoryPort,
  ProfileRepositoryPort,
} from '../../src/application/ports/profile.repository.port';
import type {
  BankAccount,
  BankVerification,
} from '../../src/domain/bank/bank-account';
import type { Nomination } from '../../src/domain/nomination/nomination';
import type { Declarations } from '../../src/domain/profile/declarations';
import type { CustomerProfile } from '../../src/domain/profile/profile';

export class FakeProfiles implements ProfileRepositoryPort {
  readonly rows: CustomerProfile[] = [];
  append(p: CustomerProfile): Promise<void> {
    this.rows.push(p);
    return Promise.resolve();
  }
  latest(applicationId: string): Promise<CustomerProfile | null> {
    return Promise.resolve(
      [...this.rows].reverse().find((r) => r.applicationId === applicationId) ??
        null,
    );
  }
}
export class FakeDeclarations implements DeclarationsRepositoryPort {
  readonly rows: Declarations[] = [];
  append(d: Declarations): Promise<void> {
    this.rows.push(d);
    return Promise.resolve();
  }
  latest(applicationId: string): Promise<Declarations | null> {
    return Promise.resolve(
      [...this.rows].reverse().find((r) => r.applicationId === applicationId) ??
        null,
    );
  }
}
export class FakeBank implements BankRepositoryPort {
  readonly accounts = new Map<string, BankAccount>();
  readonly verifications = new Map<string, BankVerification>();
  constructor(private readonly fpOf: (acc: string) => string) {}
  createAccount(a: BankAccount): Promise<void> {
    this.accounts.set(a.id, a);
    return Promise.resolve();
  }
  findAccount(id: string): Promise<BankAccount | null> {
    return Promise.resolve(this.accounts.get(id) ?? null);
  }
  findAccountByFingerprint(
    applicationId: string,
    fp: string,
  ): Promise<BankAccount | null> {
    return Promise.resolve(
      [...this.accounts.values()]
        .reverse()
        .find(
          (a) =>
            a.applicationId === applicationId &&
            this.fpOf(a.accountNumber) === fp,
        ) ?? null,
    );
  }
  createVerification(v: BankVerification): Promise<void> {
    this.verifications.set(v.id, v);
    return Promise.resolve();
  }
  findVerification(id: string): Promise<BankVerification | null> {
    return Promise.resolve(this.verifications.get(id) ?? null);
  }
  latestVerification(applicationId: string): Promise<BankVerification | null> {
    return Promise.resolve(
      [...this.verifications.values()]
        .reverse()
        .find((v) => v.applicationId === applicationId) ?? null,
    );
  }
  updateVerification(v: BankVerification): Promise<void> {
    this.verifications.set(v.id, v);
    return Promise.resolve();
  }
  countVerifications(applicationId: string): Promise<number> {
    return Promise.resolve(
      [...this.verifications.values()].filter(
        (v) => v.applicationId === applicationId,
      ).length,
    );
  }
}
export class FakeNominations implements NominationRepositoryPort {
  readonly rows: Nomination[] = [];
  append(n: Nomination): Promise<void> {
    this.rows.push(n);
    return Promise.resolve();
  }
  latest(applicationId: string): Promise<Nomination | null> {
    return Promise.resolve(
      [...this.rows].reverse().find((r) => r.applicationId === applicationId) ??
        null,
    );
  }
}
export class FakeCompliance implements ComplianceRepositoryPort {
  readonly runs: ScreeningRunRecord[] = [];
  readonly assessments: AmlAssessmentRecord[] = [];
  readonly cases: ComplianceCaseRecord[] = [];
  readonly decisions: ReviewDecisionRecord[] = [];
  findScreeningRun(id: string): Promise<ScreeningRunRecord | null> {
    return Promise.resolve(this.runs.find((r) => r.id === id) ?? null);
  }
  findAmlAssessment(id: string): Promise<AmlAssessmentRecord | null> {
    return Promise.resolve(this.assessments.find((a) => a.id === id) ?? null);
  }
  updateScreeningRun(run: ScreeningRunRecord): Promise<void> {
    const i = this.runs.findIndex((r) => r.id === run.id);
    if (i >= 0) this.runs[i] = run;
    return Promise.resolve();
  }
  updateAmlAssessment(a: AmlAssessmentRecord): Promise<void> {
    const i = this.assessments.findIndex((r) => r.id === a.id);
    if (i >= 0) this.assessments[i] = a;
    return Promise.resolve();
  }
  createCase(c: ComplianceCaseRecord): Promise<void> {
    this.cases.push(c);
    return Promise.resolve();
  }
  findCase(id: string): Promise<ComplianceCaseRecord | null> {
    return Promise.resolve(this.cases.find((c) => c.id === id) ?? null);
  }
  listOpenCases(applicationId: string): Promise<ComplianceCaseRecord[]> {
    return Promise.resolve(
      this.cases.filter(
        (c) => c.applicationId === applicationId && c.status !== 'CLOSED',
      ),
    );
  }
  updateCase(c: ComplianceCaseRecord): Promise<void> {
    const i = this.cases.findIndex((x) => x.id === c.id);
    if (i >= 0) this.cases[i] = c;
    return Promise.resolve();
  }
  createDecision(d: ReviewDecisionRecord): Promise<void> {
    this.decisions.push(d);
    return Promise.resolve();
  }
  createScreeningRun(r: ScreeningRunRecord): Promise<void> {
    this.runs.push(r);
    return Promise.resolve();
  }
  createAmlAssessment(a: AmlAssessmentRecord): Promise<void> {
    this.assessments.push(a);
    return Promise.resolve();
  }
  supersedeOpen(
    applicationId: string,
    _tx?: unknown,
    kind?: 'SCREENING' | 'AML',
  ): Promise<void> {
    if (kind !== 'AML')
      for (const r of this.runs)
        if (
          r.applicationId === applicationId &&
          (r.status === 'QUEUED' || r.status === 'RUNNING')
        )
          r.status = 'SUPERSEDED';
    if (kind !== 'SCREENING')
      for (const a of this.assessments)
        if (
          a.applicationId === applicationId &&
          (a.status === 'QUEUED' || a.status === 'RUNNING')
        )
          a.status = 'SUPERSEDED';
    return Promise.resolve();
  }
  latestScreeningRun(
    applicationId: string,
  ): Promise<ScreeningRunRecord | null> {
    return Promise.resolve(
      [...this.runs].reverse().find((r) => r.applicationId === applicationId) ??
        null,
    );
  }
  latestAmlAssessment(
    applicationId: string,
  ): Promise<AmlAssessmentRecord | null> {
    return Promise.resolve(
      [...this.assessments]
        .reverse()
        .find((r) => r.applicationId === applicationId) ?? null,
    );
  }
}

/* ---------- Phase 5 fakes ---------- */
import type {
  FeeIllustrationRecord,
  FeeRepositoryPort,
} from '../../src/application/ports/fee.repository.port';
import type { ReviewRepositoryPort } from '../../src/application/ports/review.repository.port';
import type { SuitabilityRepositoryPort } from '../../src/application/ports/suitability.repository.port';
import type { Acknowledgement } from '../../src/domain/documents/document-pack';
import type { ReviewSnapshot } from '../../src/domain/review/review-snapshot';
import type {
  InvestmentApproach,
  SuitabilityAssessment,
} from '../../src/domain/suitability/suitability';

export class FakeSuitability implements SuitabilityRepositoryPort {
  readonly assessments: SuitabilityAssessment[] = [];
  readonly approaches: InvestmentApproach[] = [];
  appendAssessment(a: SuitabilityAssessment): Promise<void> {
    this.assessments.push(a);
    return Promise.resolve();
  }
  findAssessment(id: string): Promise<SuitabilityAssessment | null> {
    return Promise.resolve(this.assessments.find((a) => a.id === id) ?? null);
  }
  latestAssessment(
    applicationId: string,
  ): Promise<SuitabilityAssessment | null> {
    return Promise.resolve(
      [...this.assessments]
        .reverse()
        .find((a) => a.applicationId === applicationId) ?? null,
    );
  }
  appendApproach(a: InvestmentApproach): Promise<void> {
    this.approaches.push(a);
    return Promise.resolve();
  }
  latestApproach(applicationId: string): Promise<InvestmentApproach | null> {
    return Promise.resolve(
      [...this.approaches]
        .reverse()
        .find((a) => a.applicationId === applicationId) ?? null,
    );
  }
}
export class FakeFees implements FeeRepositoryPort {
  readonly illustrations: FeeIllustrationRecord[] = [];
  readonly acknowledgements: Acknowledgement[] = [];
  createIllustration(r: FeeIllustrationRecord): Promise<void> {
    this.illustrations.push(r);
    return Promise.resolve();
  }
  appendAcknowledgement(a: Acknowledgement): Promise<void> {
    this.acknowledgements.push(a);
    return Promise.resolve();
  }
  latestAcknowledgement(
    applicationId: string,
  ): Promise<Acknowledgement | null> {
    return Promise.resolve(
      [...this.acknowledgements]
        .reverse()
        .find((a) => a.applicationId === applicationId) ?? null,
    );
  }
}
export class FakeReviews implements ReviewRepositoryPort {
  readonly snapshots: ReviewSnapshot[] = [];
  create(s: ReviewSnapshot): Promise<void> {
    this.snapshots.push(s);
    return Promise.resolve();
  }
  findById(id: string): Promise<ReviewSnapshot | null> {
    return Promise.resolve(this.snapshots.find((s) => s.id === id) ?? null);
  }
  current(applicationId: string): Promise<ReviewSnapshot | null> {
    return Promise.resolve(
      [...this.snapshots]
        .reverse()
        .find(
          (s) => s.applicationId === applicationId && s.status === 'CURRENT',
        ) ?? null,
    );
  }
  supersedeCurrent(applicationId: string): Promise<void> {
    this.snapshots.forEach((s, i) => {
      if (s.applicationId === applicationId && s.status === 'CURRENT')
        this.snapshots[i] = { ...s, status: 'SUPERSEDED' };
    });
    return Promise.resolve();
  }
}

/* ---------- Phase 6 fakes ---------- */
import type { AccountOpeningRepositoryPort } from '../../src/application/ports/account-opening.repository.port';
import type { ActivationRepositoryPort } from '../../src/application/ports/activation.repository.port';
import type {
  CreateSignRequestCommand,
  EsignGatewayPort,
  SignDocumentStatus,
  SignRequestCreated,
} from '../../src/application/ports/esign-gateway.port';
import type { FundingRepositoryPort } from '../../src/application/ports/funding.repository.port';
import type { SigningRepositoryPort } from '../../src/application/ports/signing.repository.port';
import type {
  DocumentRendererPort,
  RenderedText,
} from '../../src/application/ports/document-renderer.port';
import type {
  AccountOpeningRun,
  RegistrySubmission,
  UnderlyingAccount,
} from '../../src/domain/account-opening/account-opening';
import type { Activation } from '../../src/domain/activation/activation';
import type {
  FundingNotification,
  FundingReceipt,
} from '../../src/domain/funding/funding';
import type { SigningSession } from '../../src/domain/signing/signing-session';

export class FakeSigning implements SigningRepositoryPort {
  readonly rows = new Map<string, SigningSession>();
  create(s: SigningSession): Promise<void> {
    this.rows.set(s.id, s);
    return Promise.resolve();
  }
  findById(id: string): Promise<SigningSession | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  findByProviderRequestId(
    providerRequestId: string,
  ): Promise<SigningSession | null> {
    return Promise.resolve(
      [...this.rows.values()]
        .reverse()
        .find((s) => s.providerRequestId === providerRequestId) ?? null,
    );
  }
  latestForSnapshot(snapshotId: string): Promise<SigningSession | null> {
    return Promise.resolve(
      [...this.rows.values()]
        .reverse()
        .find((s) => s.snapshotId === snapshotId) ?? null,
    );
  }
  latestForApplication(applicationId: string): Promise<SigningSession | null> {
    return Promise.resolve(
      [...this.rows.values()]
        .reverse()
        .find((s) => s.applicationId === applicationId) ?? null,
    );
  }
  update(s: SigningSession): Promise<void> {
    this.rows.set(s.id, s);
    return Promise.resolve();
  }
}
export class FakeAccountOpening implements AccountOpeningRepositoryPort {
  readonly runs = new Map<string, AccountOpeningRun>();
  readonly submissions: RegistrySubmission[] = [];
  readonly accounts: UnderlyingAccount[] = [];
  createRun(r: AccountOpeningRun): Promise<void> {
    this.runs.set(r.id, r);
    return Promise.resolve();
  }
  findRun(id: string): Promise<AccountOpeningRun | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }
  latestRun(applicationId: string): Promise<AccountOpeningRun | null> {
    return Promise.resolve(
      [...this.runs.values()]
        .reverse()
        .find((r) => r.applicationId === applicationId) ?? null,
    );
  }
  updateRun(r: AccountOpeningRun): Promise<void> {
    this.runs.set(r.id, r);
    return Promise.resolve();
  }
  createSubmission(s: RegistrySubmission): Promise<void> {
    this.submissions.push(s);
    return Promise.resolve();
  }
  findSubmissionByReference(ref: {
    providerRequestId?: string;
    clientReferenceId?: string;
  }): Promise<RegistrySubmission | null> {
    return Promise.resolve(
      this.submissions.find(
        (s) =>
          (ref.providerRequestId &&
            s.providerRequestId === ref.providerRequestId) ||
          (ref.clientReferenceId &&
            s.clientReferenceId === ref.clientReferenceId),
      ) ?? null,
    );
  }
  listSubmissions(applicationId: string): Promise<RegistrySubmission[]> {
    return Promise.resolve(
      this.submissions.filter((s) => s.applicationId === applicationId),
    );
  }
  updateSubmission(s: RegistrySubmission): Promise<void> {
    const i = this.submissions.findIndex((x) => x.id === s.id);
    if (i >= 0) this.submissions[i] = s;
    return Promise.resolve();
  }
  insertUnderlyingAccountIfNew(
    a: UnderlyingAccount,
  ): Promise<{ inserted: boolean; account: UnderlyingAccount }> {
    const existing = this.accounts.find(
      (x) => x.providerReceiptKey === a.providerReceiptKey,
    );
    if (existing)
      return Promise.resolve({ inserted: false, account: existing });
    this.accounts.push(a);
    return Promise.resolve({ inserted: true, account: a });
  }
  listUnderlyingAccounts(applicationId: string): Promise<UnderlyingAccount[]> {
    return Promise.resolve(
      this.accounts.filter((a) => a.applicationId === applicationId),
    );
  }
}
export class FakeFunding implements FundingRepositoryPort {
  readonly notifications: FundingNotification[] = [];
  readonly receipts: FundingReceipt[] = [];
  createNotification(n: FundingNotification): Promise<void> {
    this.notifications.push(n);
    return Promise.resolve();
  }
  latestNotification(
    applicationId: string,
  ): Promise<FundingNotification | null> {
    return Promise.resolve(
      [...this.notifications]
        .reverse()
        .find((n) => n.applicationId === applicationId) ?? null,
    );
  }
  insertReceiptIfNew(
    r: FundingReceipt,
  ): Promise<{ inserted: boolean; receipt: FundingReceipt }> {
    const existing = this.receipts.find(
      (x) => x.providerReceiptKey === r.providerReceiptKey,
    );
    if (existing)
      return Promise.resolve({ inserted: false, receipt: existing });
    this.receipts.push(r);
    return Promise.resolve({ inserted: true, receipt: r });
  }
  listReceipts(applicationId: string): Promise<FundingReceipt[]> {
    return Promise.resolve(
      this.receipts.filter((r) => r.applicationId === applicationId),
    );
  }
  sumMatched(applicationId: string): Promise<number> {
    return Promise.resolve(
      this.receipts
        .filter(
          (r) =>
            r.applicationId === applicationId && r.matchStatus === 'MATCHED',
        )
        .reduce((s, r) => s + r.amountInr, 0),
    );
  }
}
export class FakeActivations implements ActivationRepositoryPort {
  readonly rows: Activation[] = [];
  create(a: Activation): Promise<void> {
    if (this.rows.some((x) => x.applicationId === a.applicationId))
      return Promise.reject(
        new Error('unique violation: activations.application_id'),
      );
    this.rows.push(a);
    return Promise.resolve();
  }
  findByApplication(applicationId: string): Promise<Activation | null> {
    return Promise.resolve(
      this.rows.find((a) => a.applicationId === applicationId) ?? null,
    );
  }
}
export class FakeEsign implements EsignGatewayPort {
  readonly requests: CreateSignRequestCommand[] = [];
  status: SignDocumentStatus = {
    providerDocumentId: 'DID1',
    agreementStatus: 'requested',
    signers: [{ status: 'requested' }],
    raw: {},
  };
  createSignRequest(
    cmd: CreateSignRequestCommand,
  ): Promise<SignRequestCreated> {
    this.requests.push(cmd);
    return Promise.resolve({
      providerDocumentId: `DID${this.requests.length}`,
      agreementStatus: 'requested',
      accessToken: { id: `GWT${this.requests.length}` },
      raw: { id: `DID${this.requests.length}` },
    });
  }
  getDocument(providerDocumentId: string): Promise<SignDocumentStatus> {
    return Promise.resolve({ ...this.status, providerDocumentId });
  }
  downloadSigned(): Promise<Buffer> {
    return Promise.resolve(Buffer.from('%PDF-signed'));
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
}
export class FakeRenderer implements DocumentRendererPort {
  render(doc: RenderedText, footer: string): Promise<Buffer> {
    return Promise.resolve(
      Buffer.from(
        `%PDF-fake ${doc.title}\n${JSON.stringify(doc.sections)}\n${footer}`,
      ),
    );
  }
  merge(pdfs: Buffer[]): Promise<Buffer> {
    return Promise.resolve(
      Buffer.concat([Buffer.from('%PDF-pack\n'), ...pdfs]),
    );
  }
}
