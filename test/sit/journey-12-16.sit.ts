import { randomUUID } from 'node:crypto';
import { MessageSpy } from '../../src/infrastructure/messaging/message-spy';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { startSitApp, type SitApp } from './setup/test-app';
import { eventually, startSitWorker } from './setup/worker';
import { wiremock } from './setup/wiremock';

type Json = Record<string, unknown>;
const json = (res: { body: unknown }): Json => res.body as Json;
const errorCode = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;
const idem = () => randomUUID();

/** Screens 12–16 on top of a reused-KYC application (06–08 fast-forwarded through the worker). */
describe('SIT: journey screens 12-16', () => {
  let sit: SitApp;
  let worker: Awaited<ReturnType<typeof startSitWorker>>;
  let prisma: PrismaService;
  let session = '';
  let applicationId = '';
  const phone =
    '9' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits4 = () =>
    String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  const pan = `ABJP${letter()}${digits4()}J`;
  const auth = () => ({ Authorization: `Bearer ${session}` });
  const base = () => `/v1/onboarding/applications/${applicationId}`;

  beforeAll(async () => {
    await wiremock.reset();
    sit = await startSitApp();
    worker = await startSitWorker();
    prisma = sit.app.get(PrismaService);
    const spy = sit.app.get(MessageSpy);
    const c = json(
      await sit
        .http()
        .post('/v1/auth/phone/challenges')
        .set('Idempotency-Key', idem())
        .send({
          phone,
          purpose: 'PMS_ONBOARDING',
          privacy_notice_version: 'privacy_v1',
        })
        .expect(202),
    );
    const v = json(
      await sit
        .http()
        .post(`/v1/auth/phone/challenges/${c.challenge_id as string}/verify`)
        .set('Authorization', `Bearer ${c.preauth_token as string}`)
        .set('Idempotency-Key', idem())
        .send({ otp: spy.lastFor(`+91${phone}`)!.otp })
        .expect(200),
    );
    session = v.session_token as string;
    applicationId = v.application_id as string;
    const email = `sit-${randomUUID().slice(0, 8)}@example.com`;
    const e = json(
      await sit
        .http()
        .post(`${base()}/email/challenges`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({ email })
        .expect(202),
    );
    await sit
      .http()
      .post(`${base()}/email/challenges/${e.challenge_id as string}/verify`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({ otp: spy.lastFor(email)!.otp })
      .expect(200);
    await sit
      .http()
      .put(`${base()}/eligibility`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({
        customer_type: 'INDIVIDUAL',
        residential_status: 'RESIDENT',
        intended_investment_inr: 5000000,
        distribution_route: 'DIRECT',
      })
      .expect(200);
    await sit
      .http()
      .post(`${base()}/identity-verifications`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({
        pan,
        legal_name: 'Vinod Kumar Singh',
        date_of_birth: '1955-08-16',
        permission_version: 'kyc_fetch_v1',
      })
      .expect(202);
    const kyc = await eventually(async () => {
      const r = json(
        await sit.http().get(`${base()}/kyc`).set(auth()).expect(200),
      );
      return r.status === 'EXISTING_RECORD_AVAILABLE' ? r : null;
    });
    await sit
      .http()
      .put(`${base()}/kyc/confirmation`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({
        kyc_record_version: kyc.kyc_record_version,
        details_confirmed: true,
        changes: {},
      })
      .expect(200);
  }, 90_000);
  afterAll(async () => {
    if (sit.errorLogs().length)
      console.log(JSON.stringify(sit.errorLogs(), null, 1).slice(0, 4000));
    await worker.stop();
    await sit.stop();
  });

  it('12: profile saves with versioning; a stale version is 409', async () => {
    const body = {
      occupation: 'PRIVATE_SECTOR',
      annual_income_band: 'INR_10L_25L',
      source_of_funds: ['SALARY'],
      profile_version: 0,
    };
    const r = json(
      await sit
        .http()
        .put(`${base()}/profile`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send(body)
        .expect(200),
    );
    expect(r).toEqual({
      status: 'COMPLETE',
      profile_version: 1,
      next_screen: 'TAX_DECLARATIONS',
    });
    const stale = await sit
      .http()
      .put(`${base()}/profile`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send(body)
      .expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    await sit
      .http()
      .put(`${base()}/profile`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({ ...body, occupation: 'PILOT', profile_version: 1 })
      .expect(422);
  });

  it('13: declarations require the Indian TIN to match the PAN; valid ones queue compliance work', async () => {
    const bad = await sit
      .http()
      .put(`${base()}/declarations`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({
        tax_residencies: [{ country: 'IN', tin: 'ZZZZZ9999Z' }],
        pep_declaration: 'NOT_PEP',
        declaration_version: 'declarations_v1',
      })
      .expect(422);
    expect(errorCode(bad)).toBe('ACTION_REQUIRED');
    expect(await prisma.screeningRun.count({ where: { applicationId } })).toBe(
      0,
    );
    const r = json(
      await sit
        .http()
        .put(`${base()}/declarations`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          tax_residencies: [
            { country: 'IN', tin: pan },
            { country: 'US', tin: '123-45-6789' },
          ],
          pep_declaration: 'NOT_PEP',
          declaration_version: 'declarations_v1',
        })
        .expect(200),
    );
    expect(r).toEqual({
      status: 'COMPLETE',
      additional_information_required: true,
      next_screen: 'BANK_DETAILS',
    });
    expect(
      await prisma.screeningRun.count({
        where: { applicationId, status: 'QUEUED' },
      }),
    ).toBe(1);
    expect(
      await prisma.amlAssessment.count({
        where: { applicationId, status: 'QUEUED' },
      }),
    ).toBe(1);
    expect(
      await prisma.task.count({
        where: { applicationId, category: 'FATCA_ADDITIONAL_INFO' },
      }),
    ).toBe(1);
    const decl = await prisma.declaration.findFirstOrThrow({
      where: { applicationId },
    });
    expect(Buffer.from(decl.taxResidencies).toString('utf8')).not.toContain(
      pan,
    );
  });

  it('14-15: bank verification runs through the worker and WireMock; repeated taps reuse the verification', async () => {
    const body = {
      account_number: '999900001234',
      account_number_confirmation: '999900001234',
      ifsc: 'HDFC0001234',
      holder_name: 'Vinod Kumar Singh',
    };
    const first = json(
      await sit
        .http()
        .post(`${base()}/bank-verifications`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send(body)
        .expect(202),
    );
    expect(first).toMatchObject({
      status: 'PROCESSING',
      next_screen: 'BANK_PROGRESS',
    });
    const second = json(
      await sit
        .http()
        .post(`${base()}/bank-verifications`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send(body)
        .expect(202),
    );
    expect(second.verification_id).toBe(first.verification_id);
    const done = await eventually(async () => {
      const r = json(
        await sit
          .http()
          .get(
            `${base()}/bank-verifications/${first.verification_id as string}`,
          )
          .set(auth())
          .expect(200),
      );
      return r.status !== 'PROCESSING' ? r : null;
    });
    expect(done).toEqual({
      status: 'VERIFIED',
      account_masked: '••••1234',
      required_actions: [],
      next_screen: 'NOMINATION',
    });
    const calls = await wiremock.requestsTo(
      '/digio/v4/client/verify/bank_account',
    );
    expect(calls.filter((c) => c.body.includes('999900001234'))).toHaveLength(
      1,
    );
    expect(JSON.parse(calls[0].body)).toMatchObject({
      beneficiary_name: 'Vinod Kumar Singh',
      validation_mode: 'AUTO',
    });
    expect(JSON.stringify(done)).not.toContain('92');
    await sit
      .http()
      .get(`${base()}/bank-verifications/bv_nope`)
      .set(auth())
      .expect(404);
  });

  it('16: nomination with custom allocation must sum to 100; a valid instruction advances to INVESTMENT_PROFILE', async () => {
    const bad = await sit
      .http()
      .put(`${base()}/nomination`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({
        choice: 'NOMINATE',
        allocation_mode: 'CUSTOM',
        nominees: [
          {
            full_name: 'Asha Singh',
            relationship: 'SPOUSE',
            is_minor: false,
            allocation_percent: 99,
          },
        ],
      })
      .expect(422);
    expect(errorCode(bad)).toBe('ACTION_REQUIRED');
    const r = json(
      await sit
        .http()
        .put(`${base()}/nomination`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          choice: 'NOMINATE',
          allocation_mode: 'CUSTOM',
          nominees: [
            {
              full_name: 'Asha Singh',
              relationship: 'SPOUSE',
              is_minor: false,
              allocation_percent: 60,
            },
            {
              full_name: 'Ravi Singh',
              relationship: 'SON',
              is_minor: true,
              date_of_birth: '2015-05-05',
              allocation_percent: 40,
              guardian: { full_name: 'Asha Singh', relationship: 'MOTHER' },
            },
          ],
        })
        .expect(200),
    );
    expect(r).toEqual({
      status: 'CAPTURED',
      registration_status: 'NOT_SUBMITTED',
      nomination_version: 1,
      next_screen: 'INVESTMENT_PROFILE',
    });
    const summary = json(await sit.http().get(base()).set(auth()).expect(200));
    expect(summary.next_screen).toBe('INVESTMENT_PROFILE');
    expect(
      (summary.steps as { step_id: string }[]).map((s) => s.step_id),
    ).toEqual(
      expect.arrayContaining(['PROFILE', 'DECLARATIONS', 'BANK', 'NOMINATION']),
    );
    const row = await prisma.nomination.findFirstOrThrow({
      where: { applicationId },
    });
    expect(Buffer.from(row.nomineesCiphertext).toString('utf8')).not.toContain(
      'Asha',
    );
    const blob = JSON.stringify(
      await prisma.analyticsOutbox.findMany({
        where: {
          properties: { path: ['application_id'], equals: applicationId },
        },
      }),
    );
    expect(blob).not.toContain('Asha');
    expect(blob).not.toContain('999900001234');
  });
});
