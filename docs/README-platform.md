# Platform guide

How the cross-cutting pieces fit together and how feature code should use them. Design rationale is in
`docs/superpowers/specs/2026-10-18-pms-onboarding-backend-design.md`.

## Layers

```
api/            controllers + DTOs (class-validator, swagger). No business logic, no DB, no vendor types.
application/    use-case services and ports (interfaces). Transactions start here.
domain/         pure TypeScript: value objects, state machines, policies. No Nest, no I/O.
infrastructure/ adapters: persistence (Prisma), cache (Redis), queue (BullMQ), partners (Digio, ...).
common/         cross-cutting: config, correlation, logging, errors, crypto, http, idempotency, auth.
app/            composition roots: api.module / worker.module, bootstrap, main, worker.
```

Rule of thumb: a feature service depends on **ports** from `application/ports` and on domain types only.
Modules bind ports to adapters. If a service imports from `infrastructure/` or `@prisma/client`, it is wrong.

## Correlation id

`CorrelationMiddleware` runs first on every request. It accepts `X-Correlation-ID` (or `X-Request-ID`) when it
is 1–128 printable ASCII characters, otherwise generates a UUID. The id is echoed on the response, used as
`request_id` in error envelopes, and available anywhere via `CorrelationStore.getCorrelationId()`.

Jobs carry it in their `JobEnvelope`; `BaseProcessor` restores it before `handle()` runs. Outbound calls send it
as `X-Correlation-ID` and, for Digio, as `X_REFERENCE_ID` (or the request's own unique id when one exists).

## Logging

Inject `AppLogger`, call `logger.child('MyService')` once in the constructor, then `info/warn/error/debug(msg,
fields)`. Every line carries `correlationId`, `requestId`, `principalId`, `module`. Fields pass through
`redact()` so keys like `pan_no`, `otp`, `authorization` never reach logs. Do not log request or response
bodies; log ids, outcomes and durations.

## Errors

Throw subclasses of `AppError` (`ValidationError`, `StaleVersionError`, `RateLimitedError`,
`DependencyUnavailableError`, `PartnerRejectedError`, …). `ErrorEnvelopeFilter` turns anything into
`{ error: { code, message, retryable }, request_id }` with a customer-safe message. Unknown errors become 500
with the stack logged, never returned.

## Outbound HTTP

`HttpClientService.request(spec)` is the only way out. Partner gateways live in `infrastructure/partners/<p>`
with three files per operation: `*.gateway.ts` (calls the client), `*.mapper.ts` (domain ⇄ vendor fields,
codebooks), `*.types.ts` (vendor wire types). The client adds correlation headers, auth, timeout, optional
retry (never on 4xx), a per-partner circuit breaker, and raises `PartnerHttpError`; gateways translate that to
`DependencyUnavailableError` (5xx/transport) or `PartnerRejectedError` (4xx).

## Persistence

Repositories in `infrastructure/persistence/repositories` implement ports and take an optional
`TransactionContext` as their last argument. Services use `UnitOfWork.run(async (tx) => { ... })` to commit a
state change together with its `OutboxPort.add(...)` event and `AuditPort.append(...)` row. Prisma is never
visible above the repository.

Sensitive columns are stored with `FieldCipher.encryptToBuffer()` plus a `Fingerprint.of(value, purpose)`
column for lookups.

## Async work

Write events to the outbox inside the transaction. The worker's `OutboxDispatcherProcessor` ticks every 2 s,
routes each event through `EventRouter` to a queue/job, and publishes with `jobId = outbox row id` so
redelivery is idempotent. Feature modules register routes with `EventRouter.register(eventType, {queue,
jobName})` and implement a `BaseProcessor` subclass decorated with `@Processor(QUEUES.X)`.

Webhooks: insert into `integration_inbox` first (unique per provider + event key), acknowledge, then process
in the worker.

## Idempotency and auth

Mark mutating handlers with `@Idempotent()`; the interceptor requires `Idempotency-Key`, replays the stored
response for a repeat, and returns 422 `IDEMPOTENCY_MISMATCH` when the same key arrives with a different body.

`/internal/v1` routes use `InternalServiceGuard` (`X-Internal-Token`, optional `X-Reviewer-Id`). Customer
session guards arrive in Phase 2.

## Local run

```
make up            # postgres, redis (host 6380), minio, wiremock, mailpit
cp .env.example .env && openssl rand -base64 32   # fill the three key variables
npx prisma migrate deploy
npm run start:api  # http://localhost:3000/docs
npm run start:worker
make sit           # system integration tests against the docker infra
```
