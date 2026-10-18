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

/** Screens 06–11 with the real worker consuming outbox events and WireMock standing in for Digio. */
describe('SIT: journey screens 06-11', () => {
  let sit: SitApp;
  let worker: Awaited<ReturnType<typeof startSitWorker>>;
  let prisma: PrismaService;
  let session = '';
  let applicationId = '';
  const phone =
    '9' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  // PANs are unique per run (earlier runs' identities would otherwise be duplicates) and match the WireMock patterns
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits4 = () =>
    String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  const pan = `ABJP${letter()}${digits4()}J`;
  const panNoRecord = `NORP${letter()}${digits4()}X`;
  const auth = () => ({ Authorization: `Bearer ${session}` });

  beforeAll(async () => {
    await wiremock.reset();
    sit = await startSitApp();
    worker = await startSitWorker();
    prisma = sit.app.get(PrismaService);
    // fast-forward screens 01–05
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
        .post(`/v1/onboarding/applications/${applicationId}/email/challenges`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({ email })
        .expect(202),
    );
    await sit
      .http()
      .post(
        `/v1/onboarding/applications/${applicationId}/email/challenges/${e.challenge_id as string}/verify`,
      )
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({ otp: spy.lastFor(email)!.otp })
      .expect(200);
    await sit
      .http()
      .put(`/v1/onboarding/applications/${applicationId}/eligibility`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({
        customer_type: 'INDIVIDUAL',
        residential_status: 'RESIDENT',
        intended_investment_inr: 5000000,
        distribution_route: 'DIRECT',
      })
      .expect(200);
  }, 60_000);
  afterAll(async () => {
    if (sit.errorLogs().length)
      console.log(JSON.stringify(sit.errorLogs(), null, 1).slice(0, 6000));
    await worker.stop();
    await sit.stop();
  });

  it('06: submits identity, 07: the worker runs the KRA lookup through WireMock and routes to CONFIRM_KYC', async () => {
    const res = json(
      await sit
        .http()
        .post(
          `/v1/onboarding/applications/${applicationId}/identity-verifications`,
        )
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          pan,
          legal_name: 'Vinod Kumar Singh',
          date_of_birth: '1955-08-16',
          permission_version: 'kyc_fetch_v1',
        })
        .expect(202),
    );
    expect(res).toMatchObject({
      status: 'PROCESSING',
      next_screen: 'KYC_PROGRESS',
    });
    const kyc = await eventually(async () => {
      const r = json(
        await sit
          .http()
          .get(`/v1/onboarding/applications/${applicationId}/kyc`)
          .set(auth())
          .expect(200),
      );
      return r.status === 'EXISTING_RECORD_AVAILABLE' ? r : null;
    });
    expect(kyc).toMatchObject({
      route: 'REUSE',
      next_screen: 'CONFIRM_KYC',
      details: {
        legal_name: 'VINOD KUMAR SINGH',
        address: { city: 'FARIDABAD' },
      },
    });
    const calls = await wiremock.requestsTo(
      '/digio/v3/client/kyc/kra/download_pan',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].body).not.toContain('"dob":"1955-08-16"');
    expect(calls[0].body).toContain('"dob":"16/08/1955"');
    // repeated polling never calls the provider again
    for (let i = 0; i < 10; i++)
      await sit
        .http()
        .get(`/v1/onboarding/applications/${applicationId}/kyc`)
        .set(auth())
        .expect(200);
    expect(
      await wiremock.requestsTo('/digio/v3/client/kyc/kra/v2/get_pan_status'),
    ).toHaveLength(1);
  });

  it('08: stale version is 409; confirmation completes KYC and, with the KRA IPV flag, skips IPV to PROFILE', async () => {
    const stale = await sit
      .http()
      .put(`/v1/onboarding/applications/${applicationId}/kyc/confirmation`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({ kyc_record_version: 0, details_confirmed: true, changes: {} })
      .expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    const kyc = json(
      await sit
        .http()
        .get(`/v1/onboarding/applications/${applicationId}/kyc`)
        .set(auth())
        .expect(200),
    );
    const ok = json(
      await sit
        .http()
        .put(`/v1/onboarding/applications/${applicationId}/kyc/confirmation`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          kyc_record_version: kyc.kyc_record_version,
          details_confirmed: true,
          changes: {},
        })
        .expect(200),
    );
    expect(ok).toEqual({
      status: 'CONFIRMED',
      kyc_status: 'COMPLETE',
      next_screen: 'PROFILE',
    });
    const summary = json(
      await sit
        .http()
        .get(`/v1/onboarding/applications/${applicationId}`)
        .set(auth())
        .expect(200),
    );
    expect(summary.next_screen).toBe('PROFILE');
    expect(
      (summary.steps as { step_id: string }[]).map((s) => s.step_id),
    ).toEqual(expect.arrayContaining(['IDENTITY', 'KYC', 'IPV']));
  });

  it('10: upload authorisation, real PUT to MinIO, document registration and background verification', async () => {
    const up = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${applicationId}/document-uploads`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          requirement_id: 'SELFIE',
          content_type: 'image/jpeg',
          size_bytes: 4,
        })
        .expect(200),
    );
    const put = await fetch(up.upload_url as string, {
      method: 'PUT',
      body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(put.status).toBe(200);
    const doc = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${applicationId}/documents`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          requirement_id: 'SELFIE',
          document_type: 'SELFIE',
          files: [{ upload_id: up.upload_id, side: 'PHOTO' }],
        })
        .expect(202),
    );
    expect(doc.status).toBe('PROCESSING');
    const row = await eventually(async () => {
      const r = await prisma.document.findUnique({
        where: { id: doc.document_id as string },
      });
      return r?.status !== 'PROCESSING' ? r : null;
    });
    expect(row?.status).toBe('VERIFIED');
    // a declared pdf that is really a png is rejected by the worker
    const bad = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${applicationId}/document-uploads`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          requirement_id: 'ADDRESS_PROOF',
          content_type: 'application/pdf',
          size_bytes: 8,
        })
        .expect(200),
    );
    await fetch(bad.upload_url as string, {
      method: 'PUT',
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
      headers: { 'content-type': 'application/pdf' },
    });
    const bad2 = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${applicationId}/document-uploads`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          requirement_id: 'ADDRESS_PROOF',
          content_type: 'application/pdf',
          size_bytes: 8,
        })
        .expect(200),
    );
    await fetch(bad2.upload_url as string, {
      method: 'PUT',
      body: Buffer.from('%PDF-1.7'),
      headers: { 'content-type': 'application/pdf' },
    });
    const badDoc = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${applicationId}/documents`)
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({
          requirement_id: 'ADDRESS_PROOF',
          document_type: 'PASSPORT',
          files: [
            { upload_id: bad.upload_id, side: 'PHOTO_PAGE' },
            { upload_id: bad2.upload_id, side: 'ADDRESS_PAGE' },
          ],
        })
        .expect(202),
    );
    const badRow = await eventually(async () => {
      const r = await prisma.document.findUnique({
        where: { id: badDoc.document_id as string },
      });
      return r?.status !== 'PROCESSING' ? r : null;
    });
    expect(badRow).toMatchObject({
      status: 'REJECTED',
      safeErrorCategory: 'content_type_mismatch',
    });
    // too large is refused up front
    await sit
      .http()
      .post(`/v1/onboarding/applications/${applicationId}/document-uploads`)
      .set(auth())
      .set('Idempotency-Key', idem())
      .send({
        requirement_id: 'SELFIE',
        content_type: 'image/jpeg',
        size_bytes: 12 * 1024 * 1024,
      })
      .expect(422);
  });

  it('11: with KYC complete and exempt, additional verification returns EXEMPT', async () => {
    const r = json(
      await sit
        .http()
        .post(
          `/v1/onboarding/applications/${applicationId}/kyc/additional-verifications`,
        )
        .set(auth())
        .set('Idempotency-Key', idem())
        .send({ verification_type: 'SELFIE_LIVENESS' })
        .expect(201),
    );
    expect(r).toMatchObject({ status: 'EXEMPT', next_screen: 'PROFILE' });
  });

  it('webhook: invalid checksum is 401; a signed duplicate notification yields one inbox row', async () => {
    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'KYC.REQUEST.APPROVED',
      entities: ['kyc_request'],
      payload: { kyc_request: { id: 'KIDUNKNOWN', status: 'approved' } },
    });
    await sit
      .http()
      .post('/v1/integrations/digio/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Digio-Checksum', 'deadbeef')
      .send(body)
      .expect(401);
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
    await sit
      .http()
      .post('/v1/integrations/digio/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Digio-Checksum', sig)
      .send(body)
      .expect(200, { received: true });
    const id = (JSON.parse(body) as { id: string }).id;
    const rows = await prisma.integrationInbox.findMany({
      where: { provider: 'digio', eventKey: id },
    });
    expect(rows).toHaveLength(1);
    const processed = await eventually(async () => {
      const r = await prisma.integrationInbox.findUnique({
        where: { provider_eventKey: { provider: 'digio', eventKey: id } },
      });
      return r?.status === 'PROCESSED' ? r : null;
    });
    expect(processed.status).toBe('PROCESSED');
  });

  it('09 (second application): no KRA record routes to FRESH_KYC and a DigiStudio session is created with an SDK token', async () => {
    const spy = sit.app.get(MessageSpy);
    const phone2 =
      '8' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
    const c = json(
      await sit
        .http()
        .post('/v1/auth/phone/challenges')
        .set('Idempotency-Key', idem())
        .send({
          phone: phone2,
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
        .send({ otp: spy.lastFor(`+91${phone2}`)!.otp })
        .expect(200),
    );
    const s2 = { Authorization: `Bearer ${v.session_token as string}` };
    const app2 = v.application_id as string;
    const email = `sit-${randomUUID().slice(0, 8)}@example.com`;
    const e = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${app2}/email/challenges`)
        .set(s2)
        .set('Idempotency-Key', idem())
        .send({ email })
        .expect(202),
    );
    await sit
      .http()
      .post(
        `/v1/onboarding/applications/${app2}/email/challenges/${e.challenge_id as string}/verify`,
      )
      .set(s2)
      .set('Idempotency-Key', idem())
      .send({ otp: spy.lastFor(email)!.otp })
      .expect(200);
    await sit
      .http()
      .put(`/v1/onboarding/applications/${app2}/eligibility`)
      .set(s2)
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
      .post(`/v1/onboarding/applications/${app2}/identity-verifications`)
      .set(s2)
      .set('Idempotency-Key', idem())
      .send({
        pan: panNoRecord,
        legal_name: 'Nobody Here',
        date_of_birth: '1990-01-01',
        permission_version: 'kyc_fetch_v1',
      })
      .expect(202);
    const kyc = await eventually(async () => {
      const r = json(
        await sit
          .http()
          .get(`/v1/onboarding/applications/${app2}/kyc`)
          .set(s2)
          .expect(200),
      );
      return r.status === 'NO_RECORD' ? r : null;
    });
    expect(kyc).toMatchObject({ route: 'FRESH', next_screen: 'FRESH_KYC' });
    const created = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${app2}/kyc/sessions`)
        .set(s2)
        .set('Idempotency-Key', idem())
        .send({ method: 'DIGITAL_DOCUMENTS', return_route: 'KYC_RETURN' })
        .expect(201),
    );
    expect(created).toMatchObject({
      status: 'REQUESTED',
      provider: 'DIGIO',
      next_screen: 'PROVIDER_KYC',
    });
    expect(
      (created.sdk_launch as { access_token: string }).access_token,
    ).toMatch(/^GWT/);
    const createCalls = await wiremock.requestsTo(
      '/digio/client/kyc/v2/request/with_template',
    );
    expect(createCalls).toHaveLength(1);
    expect(JSON.parse(createCalls[0].body)).toMatchObject({
      template_name: 'PMS_KYC_SIT',
      notify_customer: false,
      generate_access_token: true,
      reference_id: app2,
    });
    // resuming returns the same session with a regenerated token
    const again = json(
      await sit
        .http()
        .post(`/v1/onboarding/applications/${app2}/kyc/sessions`)
        .set(s2)
        .set('Idempotency-Key', idem())
        .send({ method: 'DIGITAL_DOCUMENTS' })
        .expect(201),
    );
    expect(again.session_id).toBe(created.session_id);
    expect((again.sdk_launch as { access_token: string }).access_token).toBe(
      'GWTREGEN0000000000000001',
    );
    // the worker polled the (still 'requested') status at least once and left the session in progress
    const polled = await eventually(async () => {
      const r = await prisma.kycSession.findUnique({
        where: { id: created.session_id as string },
      });
      return r && r.pollCount > 0 ? r : null;
    });
    expect(polled.status).toBe('IN_PROGRESS');
  }, 60_000);
});
