# WMC PMS backend

NestJS backend for JioBlackRock's PMS (Portfolio Management Service) customer onboarding.

- Design: `docs/superpowers/specs/2026-10-18-pms-onboarding-backend-design.md`
- Plans: `docs/superpowers/plans/`
- Platform guide (correlation, logging, errors, HTTP connector, persistence, queues): `docs/README-platform.md`
- Partner reference payloads: `docs/partners/`

## Quick start

```bash
npm install
make up                                   # docker infra: postgres, redis (host port 6380), minio, wiremock, mailpit
cp .env.example .env                      # then set FIELD_ENCRYPTION_KEY, FINGERPRINT_HMAC_KEY, OTP_HMAC_KEY (openssl rand -base64 32)
npx prisma migrate deploy
npm run start:api                         # API + Swagger at http://localhost:3000/docs
npm run start:worker                      # background jobs
```

## Testing

```bash
npm test          # unit tests with a 90% coverage gate (DB-backed specs use the docker infra; SKIP_DB_TESTS=1 to skip)
make sit          # system integration tests: real app, real postgres/redis, WireMock partners
npm run lint
```

## Partner credentials

Secrets never go in the repo. Digio sandbox credentials come from your Digio account manager; TrackWizz and MF
Central UAT credentials are supplied by those vendors. Put them in `.env`.
