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
const answers = (o: Record<string, string> = {}) =>
  Object.entries({
    OBJECTIVE: 'LONG_TERM_GROWTH',
    HORIZON: 'FIVE_YEARS_PLUS',
    LIQUIDITY: 'NONE_EXPECTED',
    EXPERIENCE: 'DIRECT_EQUITY',
    RISK_CAPACITY: 'LOSS_UP_TO_25',
    ...o,
  }).map(([question_id, answer_id]) => ({ question_id, answer_id }));

/** Screens 17–20 on top of an application fast-forwarded through 01–16 (worker + WireMock). */
describe('SIT: journey screens 17-20', () => {
  let sit: SitApp;
  let worker: Awaited<ReturnType<typeof startSitWorker>>;
  let prisma: PrismaService;
  let session = '';
  let applicationId = '';
  let assessmentId = '';
  const phone =
    '9' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits4 = () =>
    String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  const pan = `ABJP${letter()}${digits4()}J`;
  const auth = () => ({ Authorization: `Bearer ${session}` });
  const base = () => `/v1/onboarding/applications/${applicationId}`;
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
      const r = json(
        await sit.http().get(`${base()}/kyc`).set(auth()).expect(200),
      );
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
        account_number: '999900005678',
        account_number_confirmation: '999900005678',
        ifsc: 'HDFC0001234',
        holder_name: 'Vinod Kumar Singh',
      }).expect(202),
    );
    await eventually(async () => {
      const r = json(
        await sit
          .http()
          .get(`${base()}/bank-verifications/${bank.verification_id as string}`)
          .set(auth())
          .expect(200),
      );
      return r.status === 'VERIFIED' ? r : null;
    });
    await put('/nomination', { choice: 'OPT_OUT', nominees: [] }).expect(200);
  }, 120_000);
  afterAll(async () => {
    if (sit.errorLogs().length)
      console.log(JSON.stringify(sit.errorLogs(), null, 1).slice(0, 4000));
    await worker.stop();
    await sit.stop();
  });

  it('17: a partial questionnaire is INCOMPLETE (persisted, no approach); contradictions are 422; a complete one advances', async () => {
    const partial = json(
      await post('/suitability-assessments', {
        questionnaire_version: 'suitability_v1',
        answers: answers().slice(0, 2),
      }).expect(200),
    );
    expect(partial).toMatchObject({
      status: 'INCOMPLETE',
      missing_question_ids: ['LIQUIDITY', 'EXPERIENCE', 'RISK_CAPACITY'],
      next_screen: 'INVESTMENT_PROFILE',
    });
    const bad = await post('/suitability-assessments', {
      questionnaire_version: 'suitability_v1',
      answers: answers({ HORIZON: 'UNDER_1_YEAR' }),
    }).expect(422);
    expect(errorCode(bad)).toBe('ACTION_REQUIRED');
    expect(
      await prisma.suitabilityAssessment.count({ where: { applicationId } }),
    ).toBe(1);
    const stale = await post('/suitability-assessments', {
      questionnaire_version: 'suitability_v0',
      answers: answers(),
    }).expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    const full = json(
      await post('/suitability-assessments', {
        questionnaire_version: 'suitability_v1',
        answers: answers(),
      }).expect(200),
    );
    expect(full).toMatchObject({
      status: 'COMPLETE',
      missing_question_ids: [],
      next_screen: 'INVESTMENT_APPROACH',
    });
    assessmentId = full.assessment_id as string;
    const row = await prisma.suitabilityAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    });
    expect(row).toMatchObject({
      version: 2,
      score: 18,
      riskProfile: 'AGGRESSIVE',
    });
  });

  it('18: an approach outside the permitted band is 422; a stale assessment version is 409; the permitted one is confirmed', async () => {
    await put('/investment-approach', {
      assessment_id: assessmentId,
      assessment_version: 2,
      approach_code: 'CONSERVATIVE_INCOME',
      confirmed: true,
    }).expect(422);
    const stale = await put('/investment-approach', {
      assessment_id: assessmentId,
      assessment_version: 1,
      approach_code: 'EQUITY_GROWTH',
      confirmed: true,
    }).expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    const r = json(
      await put('/investment-approach', {
        assessment_id: assessmentId,
        assessment_version: 2,
        approach_code: 'EQUITY_GROWTH',
        confirmed: true,
      }).expect(200),
    );
    expect(r).toEqual({
      status: 'CONFIRMED',
      approach_version: 1,
      next_screen: 'FEES_DISCLOSURES',
    });
  });

  it('19: fee illustration is server-computed for the confirmed approach only; acknowledgements need every required document', async () => {
    const ill = json(
      await post('/fee-illustrations', {
        approach_code: 'EQUITY_GROWTH',
        fee_schedule_version: 'fees_v1',
        scenario_code: 'RETURN_PLUS_20',
      }).expect(200),
    );
    expect(ill).toMatchObject({
      status: 'CALCULATED',
      disclaimer_version: 'illustration_v1',
    });
    const items = Object.fromEntries(
      (ill.line_items as { code: string; amount_inr: number }[]).map((l) => [
        l.code,
        l.amount_inr,
      ]),
    );
    expect(items).toMatchObject({
      GROSS_RETURN: 1_000_000,
      MANAGEMENT_FEE: 100_000,
      PERFORMANCE_FEE: 57_375,
      NET_RETURN: 825_125,
    });
    await post('/fee-illustrations', {
      approach_code: 'FOCUSED_EQUITY',
      fee_schedule_version: 'fees_v1',
      scenario_code: 'RETURN_PLUS_20',
    }).expect(422);
    const viewedOnly = await post('/acknowledgements', {
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
          acknowledged: false,
        },
      ],
      fee_understanding_note:
        'I understand that fees are charged on my portfolio value.',
    }).expect(422);
    expect(errorCode(viewedOnly)).toBe('ACTION_REQUIRED');
    const oldPack = await post('/acknowledgements', {
      document_pack_version: 0,
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
        'I understand that fees are charged on my portfolio value.',
    }).expect(409);
    expect(errorCode(oldPack)).toBe('STALE_VERSION');
    const note = `I understand that fees are charged on my portfolio value ${applicationId}.`;
    const r = json(
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
        fee_understanding_note: note,
      }).expect(200),
    );
    expect(r).toEqual({
      status: 'RECORDED',
      fee_annexure_execution_required: true,
      next_screen: 'APPLICATION_REVIEW',
    });
    const row = await prisma.acknowledgement.findFirstOrThrow({
      where: { applicationId },
    });
    expect(
      Buffer.from(row.feeUnderstandingNote).toString('utf8'),
    ).not.toContain(applicationId);
  });

  it('20: review shows masked sections; stale version is 409; confirmation creates the snapshot and moves to signing', async () => {
    const s = json(
      await sit.http().get(`${base()}/review`).set(auth()).expect(200),
    );
    expect(s).toMatchObject({
      document_pack_version: 1,
      ready: true,
      blockers: [],
    });
    const sections = s.sections as Record<string, Record<string, unknown>>;
    expect(sections.identity.panMasked).toBe(
      `${pan.slice(0, 2)}••••••${pan.slice(-2)}`,
    );
    expect(sections.bank.accountMasked).toBe('••••5678');
    expect(JSON.stringify(s)).not.toMatch(new RegExp(`${pan}|999900005678`));
    const stale = await post('/review-confirmations', {
      application_version: (s.application_version as number) - 1,
      document_pack_version: 1,
      details_confirmed: true,
    }).expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    await post('/review-confirmations', {
      application_version: s.application_version,
      document_pack_version: 1,
      details_confirmed: false,
    }).expect(422);
    const r = json(
      await post('/review-confirmations', {
        application_version: s.application_version,
        document_pack_version: 1,
        details_confirmed: true,
      }).expect(200),
    );
    expect(r).toMatchObject({
      status: 'CONFIRMED',
      next_screen: 'SIGN_DOCUMENTS',
    });
    const snap = await prisma.reviewSnapshot.findUniqueOrThrow({
      where: { id: r.snapshot_id as string },
    });
    expect(snap).toMatchObject({
      status: 'CURRENT',
      confirmedApplicationVersion: s.application_version,
      applicationVersion: (s.application_version as number) + 1,
    });
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/);
    const summary = json(await sit.http().get(base()).set(auth()).expect(200));
    expect(summary.next_screen).toBe('SIGN_DOCUMENTS');
    expect(
      (summary.steps as { step_id: string }[]).map((x) => x.step_id),
    ).toEqual(
      expect.arrayContaining([
        'SUITABILITY',
        'APPROACH',
        'ACKNOWLEDGEMENTS',
        'REVIEW',
      ]),
    );
    const blob = JSON.stringify(
      await prisma.analyticsOutbox.findMany({
        where: {
          properties: { path: ['application_id'], equals: applicationId },
        },
      }),
    );
    expect(blob).toContain('Application Review Confirmed');
    expect(blob).not.toMatch(
      /LONG_TERM_GROWTH|EQUITY_GROWTH|AGGRESSIVE|portfolio value/,
    );
  });
});
