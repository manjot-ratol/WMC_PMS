import { createHmac, randomUUID } from 'node:crypto';
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
const answers = () =>
  Object.entries({
    OBJECTIVE: 'LONG_TERM_GROWTH',
    HORIZON: 'FIVE_YEARS_PLUS',
    LIQUIDITY: 'NONE_EXPECTED',
    EXPERIENCE: 'DIRECT_EQUITY',
    RISK_CAPACITY: 'LOSS_UP_TO_25',
  }).map(([question_id, answer_id]) => ({ question_id, answer_id }));

/** Screens 21–25 on an application fast-forwarded through 01–20; Digio eSign, custodian and bank feeds via WireMock / internal API. */
describe('SIT: journey screens 21-25', () => {
  let sit: SitApp;
  let worker: Awaited<ReturnType<typeof startSitWorker>>;
  let prisma: PrismaService;
  let session = '';
  let applicationId = '';
  let snapshotId = '';
  let signingSessionId = '';
  let paymentReference = '';
  const account = '999900007777';
  const phone =
    '9' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits4 = () =>
    String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  const pan = `ABJP${letter()}${digits4()}J`;
  const auth = () => ({ Authorization: `Bearer ${session}` });
  const base = () => `/v1/onboarding/applications/${applicationId}`;
  const internal = () => `/internal/v1/applications/${applicationId}`;
  const post = (path: string, body: unknown) =>
    sit
      .http()
      .post(`${base()}${path}`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send(body);
  const put = (path: string, body: unknown) =>
    sit
      .http()
      .put(`${base()}${path}`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send(body);
  const get = (path: string) => sit.http().get(`${base()}${path}`).set(auth());
  const feed = (path: string, body: unknown) =>
    sit
      .http()
      .post(`${internal()}${path}`)
      .set('X-Internal-Token', process.env.INTERNAL_SERVICE_TOKEN!)
      .send(body);

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
    const e = json(await post('/email/challenges', { email }).expect(202));
    await post(`/email/challenges/${e.challenge_id as string}/verify`, {
      otp: spy.lastFor(email)!.otp,
    }).expect(200);
    await put('/eligibility', {
      customer_type: 'INDIVIDUAL',
      residential_status: 'RESIDENT',
      intended_investment_inr: 5000000,
      distribution_route: 'DIRECT',
    }).expect(200);
    await post('/identity-verifications', {
      pan,
      legal_name: 'Vinod Kumar Singh',
      date_of_birth: '1955-08-16',
      permission_version: 'kyc_fetch_v1',
    }).expect(202);
    const kyc = await eventually(async () => {
      const r = json(await get('/kyc').expect(200));
      return r.status === 'EXISTING_RECORD_AVAILABLE' ? r : null;
    });
    await put('/kyc/confirmation', {
      kyc_record_version: kyc.kyc_record_version,
      details_confirmed: true,
      changes: {},
    }).expect(200);
    await put('/profile', {
      occupation: 'PRIVATE_SECTOR',
      annual_income_band: 'INR_10L_25L',
      source_of_funds: ['SALARY'],
      profile_version: 0,
    }).expect(200);
    await put('/declarations', {
      tax_residencies: [{ country: 'IN', tin: pan }],
      pep_declaration: 'NOT_PEP',
      declaration_version: 'declarations_v1',
    }).expect(200);
    const bank = json(
      await post('/bank-verifications', {
        account_number: account,
        account_number_confirmation: account,
        ifsc: 'HDFC0001234',
        holder_name: 'Vinod Kumar Singh',
      }).expect(202),
    );
    await eventually(async () => {
      const r = json(
        await get(
          `/bank-verifications/${bank.verification_id as string}`,
        ).expect(200),
      );
      return r.status === 'VERIFIED' ? r : null;
    });
    await put('/nomination', { choice: 'OPT_OUT', nominees: [] }).expect(200);
    const sa = json(
      await post('/suitability-assessments', {
        questionnaire_version: 'suitability_v1',
        answers: answers(),
      }).expect(200),
    );
    await put('/investment-approach', {
      assessment_id: sa.assessment_id,
      assessment_version: 1,
      approach_code: 'EQUITY_GROWTH',
      confirmed: true,
    }).expect(200);
    await post('/acknowledgements', {
      document_pack_version: 1,
      acknowledgements: [
        {
          document_type: 'DISCLOSURE',
          document_version: 'disclosure_v1',
          acknowledged: true,
        },
        {
          document_type: 'MITC',
          document_version: 'mitc_v1',
          acknowledged: true,
        },
      ],
      fee_understanding_note:
        'I understand that fees are charged on my portfolio value every year.',
    }).expect(200);
    const review = json(await get('/review').expect(200));
    const confirmed = json(
      await post('/review-confirmations', {
        application_version: review.application_version,
        document_pack_version: 1,
        details_confirmed: true,
      }).expect(200),
    );
    snapshotId = confirmed.snapshot_id as string;
  }, 150_000);
  afterAll(async () => {
    if (sit.errorLogs().length)
      console.log(JSON.stringify(sit.errorLogs(), null, 1).slice(0, 4000));
    await worker.stop();
    await sit.stop();
  });

  it('jobs A/B: the worker screened and risk-rated the application through the TrackWizz mock (real envelope)', async () => {
    const outcome = await eventually(async () => {
      const [run, aml] = await Promise.all([
        prisma.screeningRun.findFirst({
          where: { applicationId },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.amlAssessment.findFirst({
          where: { applicationId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return run?.status === 'PROCEED' && aml?.status === 'PROCEED'
        ? { run, aml }
        : null;
    }, 30_000);
    expect(outcome.run).toMatchObject({
      suggestedAction: 'Proceed',
      hitsCount: 0,
      confirmedHit: false,
      providerRequestId: outcome.run.id,
    });
    expect(outcome.aml).toMatchObject({ riskValue: 'Low' });
    expect(worker.trackwizz.requests.map((r) => r.purpose).sort()).toEqual([
      '01,04',
      '06',
    ]);
    expect(worker.trackwizz.requests[0].headers['apitoken']).toBe(
      'sit-api-token',
    );
  });

  it('21: a signing session renders the pack, hashes it, and opens one Digio request; funding is still withheld', async () => {
    await get('/funding-instructions').expect(422);
    const stale = await post('/signing-sessions', {
      snapshot_id: 'snap_nope',
      document_pack_version: 1,
      signing_method: 'AADHAAR_ESIGN',
    }).expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    const r = json(
      await post('/signing-sessions', {
        snapshot_id: snapshotId,
        document_pack_version: 1,
        signing_method: 'AADHAAR_ESIGN',
      }).expect(201),
    );
    expect(r).toMatchObject({
      status: 'REQUESTED',
      provider_request_id: expect.stringMatching(/^DIDC/) as string,
      sdk_launch: { access_token: expect.stringMatching(/^GWT/) as string },
    });
    signingSessionId = r.signing_session_id as string;
    const again = json(
      await post('/signing-sessions', {
        snapshot_id: snapshotId,
        document_pack_version: 1,
        signing_method: 'AADHAAR_ESIGN',
      }).expect(201),
    );
    expect(again.signing_session_id).toBe(signingSessionId);
    expect(
      await wiremock.requestsTo('/digio/v2/client/document/uploadpdf'),
    ).toHaveLength(1);
    const row = await prisma.signingSession.findUniqueOrThrow({
      where: { id: signingSessionId },
    });
    expect(row.packSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (row.documents as { documentType: string }[]).map((d) => d.documentType),
    ).toEqual([
      'MITC',
      'PMS_AGREEMENT',
      'FEE_ANNEXURE',
      'ACCOUNT_OPENING_FORM',
    ]);
  });

  it('21: the worker confirms execution from Digio status (webhook triggers the poll) and submits the application', async () => {
    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'DOC.SIGNED',
      entities: ['document'],
      payload: {
        document: {
          id: (
            await prisma.signingSession.findUniqueOrThrow({
              where: { id: signingSessionId },
            })
          ).providerRequestId,
          agreement_status: 'completed',
        },
      },
    });
    const sig = createHmac('sha256', process.env.DIGIO_WEBHOOK_SECRET!)
      .update(body)
      .digest('hex');
    await sit
      .http()
      .post('/v1/integrations/digio/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Digio-Checksum', sig)
      .send(body)
      .expect(200, { received: true });
    const done = await eventually(async () => {
      const r = json(
        await get(`/signing-sessions/${signingSessionId}`).expect(200),
      );
      return r.status === 'EXECUTED' ? r : null;
    }, 30_000);
    expect(done).toEqual({
      status: 'EXECUTED',
      document_pack_version: 1,
      evidence_available: true,
      next_screen: 'APPLICATION_PROCESSING',
    });
    expect(
      (await wiremock.requestsTo('/digio/v2/client/document/download', 'GET'))
        .length,
    ).toBeGreaterThanOrEqual(1);
    const summary = json(await get('').expect(200));
    expect(summary).toMatchObject({
      status: 'SUBMITTED',
      next_screen: 'APPLICATION_PROCESSING',
    });
  });

  it('22: processing status shows the account setup task after the run; the custodian feed makes accounts ready', async () => {
    const status = await eventually(async () => {
      const r = json(await get('/status').expect(200));
      return (r.tasks as { category: string }[]).some(
        (t) => t.category === 'ACCOUNT_SETUP',
      )
        ? r
        : null;
    }, 30_000);
    expect(status).toMatchObject({
      application_status: 'PROCESSING',
      customer_action_required: false,
      next_screen: 'APPLICATION_PROCESSING',
    });
    expect(
      await prisma.registrySubmission.findMany({
        where: { applicationId },
        select: { registry: true, status: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { registry: 'KRA', status: 'NOT_REQUIRED' },
        { registry: 'CKYC', status: 'NOT_REQUIRED' },
      ]),
    );
    await sit
      .http()
      .post(`${internal()}/underlying-accounts`)
      .send({})
      .expect(401);
    const pms = json(
      await feed('/underlying-accounts', {
        provider_receipt_key: `cust-${applicationId}-pms`,
        provider: 'CUSTODIAN',
        account_type: 'PMS_ACCOUNT',
        account_reference: `PMS${applicationId.slice(-6)}`,
        status: 'READY',
      }).expect(202),
    );
    expect(pms).toMatchObject({ status: 'RECORDED', accounts_ready: false });
    expect(
      json(
        await feed('/underlying-accounts', {
          provider_receipt_key: `cust-${applicationId}-pms`,
          provider: 'CUSTODIAN',
          account_type: 'PMS_ACCOUNT',
          account_reference: `PMS${applicationId.slice(-6)}`,
          status: 'READY',
        }).expect(202),
      ).status,
    ).toBe('DUPLICATE');
    const demat = json(
      await feed('/underlying-accounts', {
        provider_receipt_key: `dp-${applicationId}-demat`,
        provider: 'DP',
        account_type: 'DEMAT',
        account_reference: `IN${applicationId.slice(-6)}`,
        status: 'READY',
      }).expect(202),
    );
    expect(demat.accounts_ready).toBe(true);
    expect(json(await get('/status').expect(200))).toMatchObject({
      next_screen: 'FUNDING_INSTRUCTIONS',
      tasks: [],
    });
  });

  it('23: funding instructions come from configuration; the notification is only a hint', async () => {
    const i = json(await get('/funding-instructions').expect(200));
    expect(i).toMatchObject({
      status: 'READY',
      instructions_version: 1,
      beneficiary_details: {
        account_name: 'SIT PMS POOL ACCOUNT',
        account_number_masked: '••••9012',
        ifsc: 'SBIN0000001',
      },
      required_amount_inr: 5000000,
    });
    paymentReference = i.payment_reference as string;
    expect(paymentReference).toMatch(/^PMS-[A-Z0-9]{8}$/);
    const n = json(
      await post('/funding-notifications', {
        funding_method: 'BANK_TRANSFER',
        customer_transfer_reference: 'UTR9876543210',
      }).expect(202),
    );
    expect(n).toMatchObject({
      status: 'AWAITING_RECONCILIATION',
      next_screen: 'FUNDING_STATUS',
    });
    expect(json(await get('/funding-status').expect(200))).toEqual({
      funding_status: 'AWAITING_FUNDS',
      activation_status: 'NOT_READY',
      customer_action_required: false,
      next_screen: 'FUNDING_STATUS',
    });
    const row = await prisma.fundingNotification.findFirstOrThrow({
      where: { applicationId },
    });
    expect(
      Buffer.from(row.customerTransferReference).toString('utf8'),
    ).not.toContain('UTR9876543210');
  });

  it('24-25: receipts reconcile against the verified account (duplicates counted once), the worker activates exactly once', async () => {
    const receipt = (key: string, over: Record<string, unknown> = {}) => ({
      provider_receipt_key: key,
      provider: 'BANK',
      amount_inr: 2500000,
      currency: 'INR',
      source_account_number: account,
      destination_reference: paymentReference,
      value_date: '2026-10-18',
      ...over,
    });
    const foreign = json(
      await feed(
        '/funding-receipts',
        receipt(`rcpt-${applicationId}-x`, {
          source_account_number: '111100001111',
        }),
      ).expect(202),
    );
    expect(foreign).toMatchObject({
      status: 'RECORDED',
      match_status: 'UNMATCHED',
      funding_status: 'AWAITING_FUNDS',
    });
    const half = json(
      await feed(
        '/funding-receipts',
        receipt(`rcpt-${applicationId}-1`),
      ).expect(202),
    );
    expect(half).toMatchObject({
      match_status: 'MATCHED',
      funding_status: 'PARTIAL',
    });
    expect(
      json(
        await feed(
          '/funding-receipts',
          receipt(`rcpt-${applicationId}-1`),
        ).expect(202),
      ),
    ).toMatchObject({ status: 'DUPLICATE', funding_status: 'PARTIAL' });
    // the unmatched receipt left a FUNDING_REVIEW task; ops resolve it (reviewer API arrives in Phase 8)
    await prisma.task.updateMany({
      where: { applicationId, category: 'FUNDING_REVIEW' },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    const full = json(
      await feed(
        '/funding-receipts',
        receipt(`rcpt-${applicationId}-2`),
      ).expect(202),
    );
    expect(full.funding_status).toBe('RECONCILED');
    const active = await eventually(async () => {
      const r = json(await get('/funding-status').expect(200));
      return r.activation_status === 'ACTIVE' ? r : null;
    }, 30_000);
    expect(active).toEqual({
      funding_status: 'RECONCILED',
      activation_status: 'ACTIVE',
      customer_action_required: false,
      next_screen: 'PORTFOLIO',
    });
    const done = json(await get('/completion').expect(200));
    expect(done).toEqual({
      application_status: 'ACTIVE',
      pms_account_id: `PMS${applicationId.slice(-6)}`,
      onboarding_complete: true,
      first_investment_status: 'NOT_STARTED',
      next_screen: 'PORTFOLIO',
    });
    expect(await prisma.activation.count({ where: { applicationId } })).toBe(1);
    expect(
      await prisma.fundingReceipt.count({ where: { applicationId } }),
    ).toBe(3);
    const summary = json(await get('').expect(200));
    expect(summary).toMatchObject({
      status: 'ACTIVE',
      next_screen: 'PORTFOLIO',
    });
    expect(
      (summary.steps as { step_id: string }[]).map((s) => s.step_id),
    ).toEqual(
      expect.arrayContaining([
        'SIGNING',
        'ACCOUNT_OPENING',
        'FUNDING',
        'ACTIVATION',
      ]),
    );
    const blob = JSON.stringify(
      await prisma.analyticsOutbox.findMany({
        where: {
          properties: { path: ['application_id'], equals: applicationId },
        },
      }),
    );
    for (const name of [
      'Signing Request Created',
      'Document Pack Executed',
      'Application Submitted',
      'Underlying Account Ready',
      'Funding Requirement Met',
      'PMS Account Activated',
      'Onboarding Completed',
    ])
      expect(blob).toContain(name);
    expect(blob).not.toMatch(
      new RegExp(`${account}|${paymentReference}|UTR9876543210|DIDC`),
    );
  });
});
