# Phase 1: Platform Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the cross-cutting platform every later phase depends on: layered layout, config, correlation id, logging, error envelope, crypto, the common outbound HTTP connector, Prisma persistence with unit of work, Redis, BullMQ with transactional outbox, idempotency, Swagger, health, Docker Compose infra, WireMock, unit + SIT harnesses with a 90% coverage gate, and the Digio KRA connector migrated onto the new layers.

**Architecture:** NestJS 11 modular monolith with `api` and `worker` entrypoints. `common/` holds cross-cutting services with no business knowledge; `infrastructure/` implements ports; `application/` and `domain/` arrive in Phase 2 but the directories and the port pattern are established here. Everything runs locally with `docker compose`.

**Tech Stack:** TypeScript 5 strict, NestJS 11 (CJS), Prisma 6 + PostgreSQL 16, ioredis + Redis 7, BullMQ, pino, axios (only inside `common/http`), opossum, nock, Jest 30 + ts-jest, supertest, @nestjs/swagger, WireMock 3, MinIO, Mailpit, Docker Compose v2.

**Spec:** `docs/superpowers/specs/2026-10-18-pms-onboarding-backend-design.md`

## Global Constraints

- Node 21 on the dev machine, Nest 11 CommonJS build: every `@nestjs/*` add-on must be a CJS major that peers with `@nestjs/common ^11` (`@nestjs/axios@4`, `@nestjs/config@4`, `@nestjs/swagger@11`, `@nestjs/bullmq@11`).
- Only `common/http/http-client.service.ts` imports axios. Only `infrastructure/persistence` imports `@prisma/client`.
- Correlation header name `X-Correlation-ID`; fallback inbound `X-Request-ID`; valid id = 1–128 printable ASCII chars; generated id = UUID v4.
- Error envelope: `{ "error": { "code": string, "message": string, "retryable": boolean }, "request_id": string }`.
- Redaction key list: `otp, pan, pan_no, aadhaar, uid_no, account_number, tin, password, authorization, access_token, token, secret, client_secret`.
- Jest coverage thresholds: 90% lines, branches, functions, statements over `src/**`, excluding `src/**/*.module.ts`, `src/app/main.ts`, `src/app/worker.ts`, `src/**/*.types.ts`, and generated Prisma output.
- Secrets never committed; `.env.example` lists every variable.
- No vendor field names in `api/` DTOs.
- Commit after each task on branch `feat/phase1-platform`.

## Review Focus

1. A client sends `X-Correlation-ID` with 300 characters or control bytes: the server must replace it with a generated id, not echo it (Task 4 test).
2. A log call that receives an Error object with a sensitive value inside `message` or `cause`: the redactor must redact nested objects and the error's own properties, not just top-level keys (Task 5 test).
3. Partner returns HTTP 200 with a non-JSON body when JSON was expected: `HttpClientService` must raise `PartnerHttpError` with `retryable=false`, not return garbage (Task 8 test).
4. Prisma transaction throws after the outbox row was written in the same transaction: nothing is visible afterwards, including the outbox row (Task 9 test).
5. Redis unavailable when the rate limiter is consulted: the limiter must fail closed and raise `DependencyUnavailableError` (Task 10 test).

---

### Task 1: Repository restructure, tooling and Docker infrastructure

**Files:**
- Modify: `package.json` (scripts, deps, jest config moved out), `tsconfig.json` (paths), `eslint.config.mjs`, `.gitignore`, `.env.example`, `README.md`
- Create: `jest.config.ts`, `jest.sit.config.ts`, `docker-compose.yml`, `Dockerfile`, `Makefile`, `tools/wiremock/mappings/.gitkeep`, `tools/wiremock/__files/.gitkeep`, `src/app/.gitkeep`, `src/common/.gitkeep`, `src/domain/.gitkeep`, `src/application/.gitkeep`, `src/infrastructure/.gitkeep`, `src/api/.gitkeep`, `test/sit/.gitkeep`
- Delete: `src/kyc/` (controller, module, spec), `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `postman/` (replaced in Phase 2), `test/app.e2e-spec.ts`, `test/jest-e2e.json`

**Interfaces:**
- Produces: `npm run test` (unit, coverage gate), `npm run test:sit`, `npm run lint`, `npm run build`, `npm run start:api`, `npm run start:worker`, `make up|down|logs|migrate|test|sit`.

- [ ] **Step 1: `git init`, branch `feat/phase1-platform`, commit current state as baseline**

```bash
git init -b main && git add -A && git commit -m "chore: baseline before phase 1" && git checkout -b feat/phase1-platform
```

- [ ] **Step 2: Install dependencies**

```bash
npm i @nestjs/swagger@^11 @nestjs/bullmq@^11 bullmq ioredis pino pino-http nest-pino @prisma/client@^6 opossum class-validator class-transformer helmet uuid
npm i -D prisma@^6 nock @types/opossum @types/uuid pino-pretty
```

- [ ] **Step 3: Move jest config to `jest.config.ts` with coverage thresholds from Global Constraints; `jest.sit.config.ts` with `testRegex: 'test/sit/.*\\.sit\\.ts$'`, `testTimeout: 60000`, no coverage**

- [ ] **Step 4: Write `docker-compose.yml`**

Services and host ports: `postgres` (16-alpine, 5432, db `wmc_pms`, user/pass `wmc/wmc`, healthcheck `pg_isready`), `redis` (7-alpine, 6379), `minio` (9000/9001, root `minio/minio123`, bucket `pms-documents` created by a `minio-init` one-shot using `mc`), `wiremock` (`wiremock/wiremock:3`, 8080, `./tools/wiremock:/home/wiremock`, args `--global-response-templating`), `mailpit` (8025 UI / 1025 SMTP), `api` and `worker` (build from `Dockerfile`, `profiles: [app]`, env from `.env`, depend on healthy postgres/redis).

- [ ] **Step 5: Write `Dockerfile` (multi-stage: `node:22-alpine` build with `npm ci && npx prisma generate && npm run build`; runtime `node:22-alpine` with `dist`, `node_modules` pruned to prod, `CMD ["node","dist/app/main.js"]`; worker overrides command)**

- [ ] **Step 6: Write `Makefile` targets: `up` (`docker compose up -d postgres redis minio minio-init wiremock mailpit`), `down`, `logs`, `migrate` (`npx prisma migrate deploy`), `test`, `sit` (`make up && npm run test:sit`), `app-up` (`docker compose --profile app up --build`)**

- [ ] **Step 7: Delete the files listed above; update `package.json` scripts: `start:api: nest start --entryFile app/main`, `start:worker: nest start --entryFile app/worker`, `start:dev: nest start --watch --entryFile app/main`, `test: jest --config jest.config.ts`, `test:sit: jest --config jest.sit.config.ts --runInBand`, `prisma:generate`, `prisma:migrate`**

- [ ] **Step 8: Write `.env.example` with every variable Tasks 2–13 read (listed in Task 2)**

- [ ] **Step 9: Verify: `make up` brings all infra healthy; `docker compose ps` shows 5 running services; `curl -s localhost:8080/__admin/health` returns healthy**

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore: restructure repo, add docker infra, jest configs and tooling"
```

---

### Task 2: Typed configuration

**Files:**
- Create: `src/common/config/app.config.ts`, `database.config.ts`, `redis.config.ts`, `storage.config.ts`, `auth.config.ts`, `crypto.config.ts`, `partners.config.ts`, `config.module.ts`, `env.validation.ts`, `index.ts`
- Move: `src/config/digio.config.ts` → `src/common/config/partners.config.ts` (digio section)
- Test: `src/common/config/env.validation.spec.ts`

**Interfaces:**
- Produces: `ConfigModule` (global) and `registerAs` namespaces: `appConfig` `{ env: 'local'|'test'|'production', port: number, serviceName: string, logLevel: string, internalServiceToken: string }`; `databaseConfig` `{ url: string }`; `redisConfig` `{ url: string }`; `storageConfig` `{ endpoint, accessKey, secretKey, bucket, region }`; `authConfig` `{ sessionTtlSeconds: number, preAuthTtlSeconds: number, otpTtlSeconds: 300, otpResendAfterSeconds: 30, otpMaxAttempts: 5 }`; `cryptoConfig` `{ fieldKeyId: string, fieldKeyBase64: string, fingerprintKeyBase64: string, otpHmacKeyBase64: string }`; `partnersConfig` `{ digio: { baseUrl, clientId, clientSecret, timeoutMs, webhookSecret }, trackwizz: { baseUrl, apiToken, cluster: 'CL1_User', domain, sourceSystemName, ourPrivateKeyPem, theirPublicKeyPem, timeoutMs }, mfcentral: { baseUrl, clientId, clientSecret, username, password, encryptionKey, privateJwk, timeoutMs }, clevertap: { baseUrl, accountId, passcode, enabled: boolean }, messaging: { smtpHost, smtpPort, from } }`.
- `validateEnv(raw: Record<string, unknown>): ValidatedEnv` throws listing every missing/invalid variable at once.

- [ ] **Step 1: Write failing tests** in `env.validation.spec.ts`: `rejects when DATABASE_URL missing (message names it)`, `applies defaults (PORT 3000, OTP_TTL_SECONDS 300)`, `rejects non-base64 FIELD_ENCRYPTION_KEY`, `collects all errors in one throw`.
- [ ] **Step 2: Run `npx jest src/common/config` → FAIL (module not found)**
- [ ] **Step 3: Implement `env.validation.ts` with class-validator on an `EnvSchema` class; implement the `registerAs` namespaces reading from the validated env; `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, load: [...] })`**
- [ ] **Step 4: Run tests → PASS**
- [ ] **Step 5: Commit** `feat(config): typed, validated configuration namespaces`

---

### Task 3: Error model and envelope filter

**Files:**
- Create: `src/common/errors/app-error.ts`, `error-codes.ts`, `error-envelope.filter.ts`, `index.ts`
- Test: `src/common/errors/app-error.spec.ts`, `error-envelope.filter.spec.ts`

**Interfaces:**
- Produces: `abstract class AppError extends Error { constructor(code: ErrorCode, message: string, opts?: { httpStatus?: number; retryable?: boolean; cause?: unknown; details?: Record<string, unknown> }) }` with subclasses `ValidationError` (422 `ACTION_REQUIRED`), `UnauthenticatedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `StaleVersionError` (409 `STALE_VERSION`), `RateLimitedError` (429 `RATE_LIMITED`, retryable), `DependencyUnavailableError` (503 `VERIFICATION_UNAVAILABLE`, retryable), `IdempotencyMismatchError` (422 `IDEMPOTENCY_MISMATCH`), `InternalError` (500 `INTERNAL_ERROR`).
- `ErrorCode` string union in `error-codes.ts` with the customer-safe default message per code (spec wording: `RATE_LIMITED` → "Please try again after the cooldown.", `OTP_INVALID_OR_EXPIRED` → "The code is invalid or expired. Request a new code if needed.", `ACTION_REQUIRED` → "Complete the required information to continue.", `STALE_VERSION` → "Your application has changed. Review the latest details.", `VERIFICATION_UNAVAILABLE` → "Verification is temporarily unavailable. Your progress is saved.").
- `ErrorEnvelopeFilter implements ExceptionFilter` (global): maps `AppError`, Nest `HttpException` (incl. class-validator 400 → 422 `ACTION_REQUIRED`), and unknown errors (500, generic message, logged with stack) to the envelope; `request_id` = correlation id from Task 4's store.

- [ ] **Step 1: Write failing tests**: `AppError carries code/status/retryable`; filter: `maps StaleVersionError to 409 envelope`, `maps unknown Error to 500 with generic message and no stack in body`, `maps class-validator BadRequestException to 422 ACTION_REQUIRED`, `request_id equals correlation id`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** `feat(errors): AppError hierarchy and spec error envelope filter`

---

### Task 4: Correlation context

**Files:**
- Create: `src/common/correlation/correlation.store.ts`, `correlation.middleware.ts`, `correlation.constants.ts`, `correlation.decorator.ts`, `correlation.module.ts`, `index.ts`
- Test: `src/common/correlation/correlation.store.spec.ts`, `correlation.middleware.spec.ts`

**Interfaces:**
- Produces: `interface CorrelationContext { correlationId: string; requestId: string; principalId?: string; reviewerId?: string }`; `class CorrelationStore { run<T>(ctx: CorrelationContext, fn: () => T): T; get(): CorrelationContext | undefined; getCorrelationId(): string /* 'none' when outside a context */; set(patch: Partial<CorrelationContext>): void }` (singleton over `AsyncLocalStorage`); `CORRELATION_HEADER = 'X-Correlation-ID'`, `REQUEST_ID_HEADER = 'X-Request-ID'`; `isValidCorrelationId(v: unknown): v is string`; `CorrelationMiddleware` (Nest `NestMiddleware`) reads headers, generates UUID when invalid/missing, sets response header, runs `next()` inside `store.run`; `@Correlation()` param decorator returning the context.

- [ ] **Step 1: Write failing tests**: store `get() inside run returns ctx and undefined outside`, `nested async calls see the same id`; middleware `uses X-Correlation-ID when valid`, `falls back to X-Request-ID`, `generates UUID v4 when absent`, `replaces id longer than 128 chars or containing control bytes` (Review Focus 1), `sets X-Correlation-ID response header`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** `feat(correlation): AsyncLocalStorage context and middleware`

---

### Task 5: Logging service

**Files:**
- Create: `src/common/logging/logger.service.ts`, `redaction.ts`, `request-logging.interceptor.ts`, `logging.module.ts`, `index.ts`
- Test: `src/common/logging/redaction.spec.ts`, `logger.service.spec.ts`, `request-logging.interceptor.spec.ts`

**Interfaces:**
- Produces: `class AppLogger implements LoggerService { constructor(store: CorrelationStore, cfg: appConfig); child(module: string): AppLogger; debug|info|warn|error(msg: string, fields?: Record<string, unknown>): void }` writing pino JSON with fields `correlationId, requestId, principalId, module, ...fields`; `redact(value: unknown, keys?: ReadonlySet<string>): unknown` deep-copies replacing any key in `REDACTED_KEYS` (case-insensitive) with `'[REDACTED]'`, handling arrays, `Error` instances (keeps `name`, redacted `message` if it contains `key=value` of a sensitive key, `stack` kept, `cause` recursed) and circular refs; `RequestLoggingInterceptor` logs `http.request` with `method, route (template), status, durationMs` only.
- Nest bootstrap uses `app.useLogger(app.get(AppLogger))`.

- [ ] **Step 1: Write failing tests**: redaction `redacts nested pan_no and Authorization`, `redacts inside arrays`, `redacts Error.cause object fields` (Review Focus 2), `survives circular references`; logger `includes correlationId from store`, `child sets module`; interceptor `logs route template not raw path, with status and duration`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement (pino `redact` option plus the custom deep redactor for `fields`)**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** `feat(logging): pino logger with correlation and redaction`

---

### Task 6: Crypto primitives

**Files:**
- Create: `src/common/crypto/field-cipher.ts`, `fingerprint.ts`, `constant-time.ts`, `crypto.module.ts`, `index.ts`
- Test: `src/common/crypto/field-cipher.spec.ts`, `fingerprint.spec.ts`, `constant-time.spec.ts`

**Interfaces:**
- Produces: `class FieldCipher { encrypt(plaintext: string): EncryptedField; decrypt(f: EncryptedField): string }` with `interface EncryptedField { keyId: string; iv: Buffer; tag: Buffer; ciphertext: Buffer }` and `serialize(f): Buffer` / `deserialize(b: Buffer): EncryptedField` (layout: 1-byte keyId length, keyId, 12-byte IV, 16-byte tag, ciphertext); AES-256-GCM with key from `cryptoConfig.fieldKeyBase64`. `class Fingerprint { of(value: string, purpose: 'phone'|'email'|'pan'|'account'|'otp'): string /* hex HMAC-SHA256 of normalized value with purpose as domain separator */ }`; `constantTimeEquals(a: string, b: string): boolean`.

- [ ] **Step 1: Write failing tests**: `round-trips unicode`, `different IV per call`, `tampered tag fails`, `wrong keyId rejected`, `serialize/deserialize round-trip`; fingerprint `deterministic`, `purpose separates`, `normalizes case/whitespace for email and pan`; `constantTimeEquals false on length mismatch`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement with `node:crypto`**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** `feat(crypto): AES-GCM field cipher, HMAC fingerprints`

---

### Task 7: Common outbound HTTP connector

**Files:**
- Create: `src/common/http/http-client.service.ts`, `http-request.types.ts`, `partner-http.error.ts`, `retry.policy.ts`, `circuit-breaker.registry.ts`, `http.module.ts`, `index.ts`
- Test: `src/common/http/http-client.service.spec.ts` (nock), `retry.policy.spec.ts`

**Interfaces:**
- Produces:
```ts
type Partner = 'digio' | 'trackwizz' | 'mfcentral' | 'ignosis' | 'clevertap' | 'messaging';
interface HttpRequestSpec<TBody = unknown> {
  partner: Partner; operation: string; method: 'GET'|'POST'|'PUT'|'DELETE';
  url: string; headers?: Record<string,string>; query?: Record<string,string|number|boolean|undefined>;
  body?: TBody; bodyType?: 'json'|'form'|'multipart'|'text'; responseType?: 'json'|'text'|'arraybuffer';
  auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string } | { type: 'none' };
  timeoutMs?: number; retry?: RetryPolicy; vendorReferenceHeader?: string;
}
interface HttpResult<T> { status: number; headers: Record<string,string>; data: T; durationMs: number }
class PartnerHttpError extends AppError { partner; operation; status?: number; vendorCode?: string; body?: unknown; retryable: boolean; isTransport: boolean }
class HttpClientService { request<T>(spec: HttpRequestSpec): Promise<HttpResult<T>> }
interface RetryPolicy { attempts: number; backoffMs: number; retryOn?: (e: PartnerHttpError) => boolean } // default: attempts 1 (no retry)
```
- Behaviour: adds `X-Correlation-ID` (from store) and, when `vendorReferenceHeader` is set, that header with the same value; default timeout from `partnersConfig[partner].timeoutMs`; retries only when `retry` given and `retryOn` (default: transport or 5xx) is true; opossum breaker per partner (50% error threshold over 10s, 30s reset) → `DependencyUnavailableError` when open; logs `partner, operation, status, durationMs` via `AppLogger`, never bodies; `responseType: 'json'` with non-JSON body → `PartnerHttpError{retryable:false, vendorCode:'INVALID_RESPONSE'}` (Review Focus 3).

- [ ] **Step 1: Write failing tests** with nock: `sends correlation and vendor reference headers`, `basic auth header`, `maps 400 JSON body to PartnerHttpError with vendorCode from body.code`, `retries on 503 then succeeds (2 calls)`, `does not retry 4xx`, `timeout → transport error retryable`, `non-JSON 200 → INVALID_RESPONSE not retryable`, `open breaker → DependencyUnavailableError without network call`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** `feat(http): common outbound HTTP connector with retry and circuit breaker`

---

### Task 8: Persistence: Prisma, unit of work, reliability tables

**Files:**
- Create: `prisma/schema.prisma`, `prisma/migrations/*` (via `prisma migrate dev --name phase1_reliability`), `src/infrastructure/persistence/prisma.service.ts`, `unit-of-work.ts`, `transaction-context.ts`, `persistence.module.ts`, `repositories/outbox.repository.ts`, `repositories/inbox.repository.ts`, `repositories/idempotency.repository.ts`, `repositories/audit.repository.ts`, `index.ts`
- Create ports: `src/application/ports/unit-of-work.port.ts`, `outbox.port.ts`, `inbox.port.ts`, `idempotency.port.ts`, `audit.port.ts`, `clock.port.ts`, `id-generator.port.ts`
- Test: `src/infrastructure/persistence/unit-of-work.spec.ts`, `repositories/outbox.repository.spec.ts`, `idempotency.repository.spec.ts` (run against docker Postgres on `DATABASE_URL_TEST`, schema reset per file)

**Interfaces:**
- Schema (schemas `reliability`, Prisma multiSchema): `business_outbox(id uuid pk, aggregate_type, aggregate_id, event_type, payload jsonb, correlation_id, created_at, dispatched_at null, attempts int, last_error null)`, `analytics_outbox(id, event_name, identity, properties jsonb, correlation_id, created_at, dispatched_at, attempts)`, `integration_inbox(id uuid, provider, event_key unique(provider,event_key), payload jsonb, received_at, processed_at null, status 'RECEIVED'|'PROCESSED'|'FAILED', correlation_id)`, `idempotency_records(principal_id, route, key, request_hash, status_code, response_body jsonb, created_at, expires_at; pk (principal_id, route, key))`, `audit_events(id bigserial, occurred_at, actor_type 'CUSTOMER'|'SYSTEM'|'REVIEWER'|'PARTNER', actor_id, action, aggregate_type, aggregate_id, correlation_id, details jsonb)` append-only (no update/delete in repository).
- `interface UnitOfWork { run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> }`; `TransactionContext` is an opaque class wrapping the Prisma transaction client; every repository method takes `tx?: TransactionContext` last and falls back to the root client.
- `interface OutboxPort { add(tx, e: { aggregateType, aggregateId, eventType, payload }): Promise<string>; claimBatch(limit: number): Promise<OutboxRow[]>; markDispatched(id): Promise<void>; markFailed(id, error: string): Promise<void> }`; `InboxPort { insertIfNew(provider, eventKey, payload): Promise<{ inserted: boolean; id: string }>; markProcessed(id) ; markFailed(id, err) }`; `IdempotencyPort { find(principalId, route, key); save(record) }`; `AuditPort { append(tx, event) }`; `ClockPort { now(): Date }`; `IdGeneratorPort { uuid(): string }`.
- Outbox `add` records `correlation_id` from `CorrelationStore` automatically.

- [ ] **Step 1: Write failing tests**: `uow commits both outbox and audit rows`, `uow rolls back everything when fn throws, including the outbox row` (Review Focus 4), `inbox insertIfNew returns inserted=false on duplicate`, `idempotency save/find round trip`, `audit repository exposes no update/delete`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Write schema, run migration against docker Postgres, implement service/uow/repositories**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** `feat(persistence): prisma, unit of work, outbox/inbox/idempotency/audit`

---

### Task 9: Redis: locks, rate limiter, key-value store

**Files:**
- Create: `src/infrastructure/cache/redis.provider.ts`, `lock.service.ts`, `rate-limiter.service.ts`, `kv-store.service.ts`, `cache.module.ts`, `index.ts`
- Ports: `src/application/ports/lock.port.ts`, `rate-limiter.port.ts`, `kv-store.port.ts`
- Test: `src/infrastructure/cache/lock.service.spec.ts`, `rate-limiter.service.spec.ts`, `kv-store.service.spec.ts` (docker Redis, db index 15 flushed per test)

**Interfaces:**
- `LockPort { withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> }` throws `LockUnavailableError` (409) when held.
- `RateLimiterPort { consume(scope: string, fingerprint: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> }` using a Lua INCR+EXPIRE script; Redis error → `DependencyUnavailableError` (fail closed, Review Focus 5).
- `KvStorePort { setJson(key, value, ttlSeconds); getJson<T>(key): Promise<T|null>; del(key); getAndDel<T>(key) /* atomic GETDEL */ ; incrWithLimit(key, max): Promise<number> }`.
- Key prefix constants: `otp:phone:`, `otp:email:`, `rl:`, `session:`, `preauth:`, `lock:`, `progress:`.

- [ ] **Step 1: Write failing tests**: lock `second caller rejected while held, allowed after release`, limiter `allows up to limit then denies with retryAfter`, `fails closed when Redis is down (client pointed at a closed port)`, kv `getAndDel returns value once`.
- [ ] **Step 2–4: FAIL → implement → PASS**
- [ ] **Step 5: Commit** `feat(cache): redis lock, rate limiter and kv store`

---

### Task 10: Queues and outbox dispatcher

**Files:**
- Create: `src/infrastructure/queue/queue.names.ts`, `queue.module.ts`, `job-context.ts`, `base.processor.ts`, `outbox-dispatcher.processor.ts`, `outbox-dispatcher.scheduler.ts`, `event-router.ts`, `index.ts`
- Ports: `src/application/ports/job-publisher.port.ts`
- Test: `src/infrastructure/queue/job-context.spec.ts`, `outbox-dispatcher.processor.spec.ts`, `event-router.spec.ts`

**Interfaces:**
- `QUEUES = { OUTBOX: 'outbox-dispatch', ANALYTICS: 'analytics-dispatch', IDENTITY: 'identity-verification', KYC_STATUS: 'kyc-status', DOCUMENTS: 'document-processing', BANK: 'bank-verification', SCREENING: 'screening', AML: 'aml-assessment', ACCOUNT_OPENING: 'account-opening', WEBHOOKS: 'webhook-processing', ACTIVATION: 'activation' } as const`.
- `interface JobEnvelope<T> { correlationId: string; payload: T }`; `JobPublisherPort { publish<T>(queue: QueueName, name: string, payload: T, opts?: { jobId?: string; delayMs?: number }): Promise<void> }` wraps payload in `JobEnvelope` with the current correlation id.
- `abstract class BaseProcessor<T> extends WorkerHost { process(job) { return store.run({correlationId: job.data.correlationId, requestId: job.id}, () => this.handle(job.data.payload, job)) } abstract handle(payload: T, job): Promise<void> }`.
- `EventRouter { register(eventType: string, target: { queue: QueueName; jobName: string }): void; route(eventType): target | undefined }`; `OutboxDispatcherProcessor` claims a batch (50), publishes each via `JobPublisherPort` with `jobId = outboxId`, marks dispatched, marks failed on error; `OutboxDispatcherScheduler` enqueues a repeatable `tick` job every 2 s (BullMQ repeat with `jobId: 'outbox-tick'`).

- [ ] **Step 1: Write failing tests**: `BaseProcessor restores correlation id from envelope`, `publisher wraps payload with current correlation id`, `dispatcher routes known event, marks dispatched; unknown event marked failed with reason`, `router returns undefined for unknown`.
- [ ] **Step 2–4: FAIL → implement (BullMQ with docker Redis for integration-ish tests; unit tests mock `Queue`) → PASS**
- [ ] **Step 5: Commit** `feat(queue): bullmq module, correlation-aware processors, outbox dispatcher`

---

### Task 11: Idempotency interceptor and internal service guard

**Files:**
- Create: `src/common/idempotency/idempotency.interceptor.ts`, `idempotency.decorator.ts`, `index.ts`; `src/common/auth/internal-service.guard.ts`, `principal.ts`, `principal.decorator.ts`, `auth.module.ts`, `index.ts`
- Test: `src/common/idempotency/idempotency.interceptor.spec.ts`, `src/common/auth/internal-service.guard.spec.ts`

**Interfaces:**
- `@Idempotent()` method decorator marks a handler; interceptor requires `Idempotency-Key` header (1–128 chars) else 422 `ACTION_REQUIRED` with message "Idempotency-Key header is required"; key scope = `principal.id` (or `anon:<correlationId-less fingerprint of ip>` for pre-auth routes) + route template + key; same key + same body hash → replay stored status/body with header `Idempotent-Replay: true`; same key + different hash → `IdempotencyMismatchError`; records expire after 24 h.
- `interface Principal { kind: 'CUSTOMER'|'PREAUTH'|'INTERNAL'|'REVIEWER'; id: string; applicationIds?: string[]; challengeId?: string; reviewerId?: string }`; `@CurrentPrincipal()` param decorator; `InternalServiceGuard` checks `X-Internal-Token` with `constantTimeEquals` against `appConfig.internalServiceToken`, optional `X-Reviewer-Id` populates `principal.reviewerId` and `CorrelationStore.set({reviewerId})`; missing/invalid → 401.

- [ ] **Step 1: Write failing tests**: interceptor `missing header → 422`, `first call executes and stores`, `replay returns stored body and header`, `mismatch → 422 IDEMPOTENCY_MISMATCH`; guard `valid token passes and sets INTERNAL principal`, `reviewer id captured`, `invalid token → 401`.
- [ ] **Step 2–4: FAIL → implement → PASS**
- [ ] **Step 5: Commit** `feat(idempotency,auth): idempotency interceptor and internal service guard`

---

### Task 12: Composition roots, Swagger, health, validation pipe, security headers

**Files:**
- Create: `src/app/api.module.ts`, `src/app/worker.module.ts`, `src/app/main.ts`, `src/app/worker.ts`, `src/app/bootstrap.ts`, `src/common/swagger/swagger.setup.ts`, `src/common/validation/validation.pipe.ts`, `src/api/health/health.controller.ts`, `src/api/health/health.module.ts`
- Modify: `nest-cli.json` (`entryFile: app/main`), delete `src/main.ts`, `src/app.module.ts`
- Test: `src/api/health/health.controller.spec.ts`, `src/app/bootstrap.spec.ts` (builds app, asserts middleware/filter/pipe registered via a request through supertest)

**Interfaces:**
- `createApiApp(): Promise<INestApplication>` in `bootstrap.ts`: helmet, `json({limit:'1mb'})`, `CorrelationMiddleware` first, global `ErrorEnvelopeFilter`, global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, `RequestLoggingInterceptor`, Swagger at `/docs` (`/docs-json` raw) with bearer + `X-Internal-Token` security schemes and `Idempotency-Key` + `X-Correlation-ID` global header params; `main.ts` listens on `appConfig.port`; `worker.ts` creates an application context from `WorkerModule` and keeps it alive.
- `GET /health` → `{ status: 'ok', service, version }`; `GET /health/ready` → checks Postgres (`SELECT 1`) and Redis (`PING`), 503 with per-dependency status when any fails.
- `npm run openapi:export` writes `openapi/openapi.json` from the built app (script `tools/export-openapi.ts`).

- [ ] **Step 1: Write failing tests**: `GET /health 200`, `GET /health/ready 503 when redis ping rejects`, `unknown route → envelope 404 with request_id`, `response carries X-Correlation-ID`, `GET /docs-json has openapi 3.x and the two security schemes`.
- [ ] **Step 2–4: FAIL → implement → PASS; also `npm run build` succeeds and `node dist/app/main.js` boots against `make up` infra**
- [ ] **Step 5: Commit** `feat(app): api/worker bootstrap, swagger, health, validation`

---

### Task 13: Migrate Digio KRA connector onto the platform

**Files:**
- Create: `src/infrastructure/partners/digio/digio.config.ts` (reads `partnersConfig.digio`), `digio-gateway.base.ts`, `kra/kra.gateway.ts`, `kra/kra.types.ts` (moved), `kra/kra.mapper.ts`, `digio.module.ts`, `index.ts`
- Ports: `src/application/ports/kra-gateway.port.ts`
- Delete: `src/connectors/**`, `src/config/**`
- Test: `src/infrastructure/partners/digio/kra/kra.gateway.spec.ts` (nock), `kra.mapper.spec.ts`

**Interfaces:**
- `interface KraGatewayPort { checkPanStatus(q: KraPanQuery): Promise<KraStatusResult>; fetchDetails(q: KraPanQuery & { dob: IsoDate }, opts?: { deserializeCodes?: boolean }): Promise<KraRecord>; register(cmd: KraRegistrationCommand): Promise<KraRegistrationResult>; downloadDocuments(q: { pan: string; dob?: IsoDate; refNo?: string; kraCode: string; serviceProvider: KraServiceProvider }): Promise<Buffer> }` where `KraPanQuery = { pan: string; dob?: IsoDate; fetchType?: 'I'|'E'; serviceProvider?: KraServiceProvider; uniqueRequestId: string }` and results are domain-shaped camelCase (`KraStatusResult { pan, name, statusCode, status, statusDescription, kraStatusCode, statusDate, entryDate, modificationDate, ipvFlag, kycMode, refId, raw: unknown }`).
- `kra.mapper.ts`: `toCheckPanRequest`, `toFetchRequest`, `toRegisterRequest` (serialises `IsoDate` → `DD/MM/YYYY`), `fromStatusResponse`, `fromFetchResponse`, `fromRegisterResponse`. Vendor snake_case lives only in `kra.types.ts` + mapper.
- `DigioGatewayBase` provides `post<T>(operation, path, body, opts)` on `HttpClientService` with basic auth from config, `vendorReferenceHeader: 'X_REFERENCE_ID'`, timeout, and maps `PartnerHttpError` → `DependencyUnavailableError` for 5xx/transport, `PartnerRejectedError` (new, 502 `PARTNER_REJECTED`, not retryable, carries `vendorCode`) for 4xx.
- The four Digio spec JSONs from `/swagger/*.json` are saved under `docs/partners/digio/kra/*.min.json` as the reference for the types.

- [ ] **Step 1: Write failing tests**: mapper `dates serialised DD/MM/YYYY`, `register uses common_kra_registration_request with martial_status spelling`; gateway with nock `sends basic auth and X_REFERENCE_ID = uniqueRequestId`, `fetch adds deserialize_codes query`, `download returns Buffer on application/octet-stream and rejects on JSON 200`, `Digio 400 → PartnerRejectedError with vendorCode`.
- [ ] **Step 2–4: FAIL → implement, delete old connector/controller → PASS; `npm run lint` clean**
- [ ] **Step 5: Commit** `refactor(digio): move KRA connector onto HttpClientService and ports`

---

### Task 14: SIT harness and smoke suite

**Files:**
- Create: `test/sit/setup/global-setup.ts` (waits for infra on `make up`, runs `prisma migrate deploy` on test DB, resets WireMock), `test/sit/setup/test-app.ts` (`startSitApp(): Promise<{ app, http: supertest.SuperTest, stop }>` using `createApiApp` with `.env.test`), `test/sit/setup/wiremock.ts` (`stubFor(mapping)`, `reset()`, `verifyCalls(urlPattern)`), `test/sit/platform.sit.ts`, `.env.test`, `tools/wiremock/mappings/digio-kra-check-pan-status.json`
- Modify: `jest.sit.config.ts` (globalSetup), `Makefile` (`sit`), `README.md`

**Interfaces:**
- `.env.test` points at docker infra with `DATABASE_URL=postgresql://wmc:wmc@localhost:5432/wmc_pms_test`, `REDIS_URL=redis://localhost:6379/15`, `DIGIO_BASE_URL=http://localhost:8080/digio`, etc.

- [ ] **Step 1: Write SIT tests**: `health ready is 200 with live infra`, `unknown route returns envelope with request_id equal to sent X-Correlation-ID`, `invalid correlation header is replaced`, `log output of a request contains the correlation id` (capture pino stream), `KraGateway against WireMock returns mapped status (uses mapping file)`, `WireMock 503 → DependencyUnavailableError`.
- [ ] **Step 2: Run `make sit` → FAIL (no harness)**
- [ ] **Step 3: Implement harness**
- [ ] **Step 4: Run `make sit` → PASS; run `npm test` → coverage ≥ 90% across all thresholds**
- [ ] **Step 5: Commit** `test(sit): system integration harness with docker infra and wiremock`

---

### Task 15: CI workflow and docs

**Files:**
- Create: `.github/workflows/ci.yml` (jobs: lint+build, unit with coverage artifact, sit with `docker compose` services), `docs/README-platform.md` (how correlation, logging, errors, http connector, uow, outbox, idempotency are used; one short example each)
- Modify: `README.md` (replace Phase-0 content; link design, plan, platform doc)

- [ ] **Step 1: Write workflow; run `act`-free verification by executing the same commands locally: `npm run lint && npm run build && npm test && make sit`**
- [ ] **Step 2: Commit** `ci: lint, unit coverage and SIT pipeline; platform docs`
