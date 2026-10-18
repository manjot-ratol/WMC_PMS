import type { Job } from 'bullmq';
import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeCustomers,
  FakeIdentities,
  FakeInbox,
  FakeJobs,
  FakeKycRecords,
  FakeMfCentral,
  FakePortfolio,
  FakeStorage,
  FakeUow,
  FixedClock,
  SeqIds,
  silentLogger,
} from '../../../test/support/fakes';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  NotFoundError,
  PartnerRejectedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  newProvisionalCustomer,
  verifyEmail,
  proposeEmail,
  verifyPhone,
} from '../../domain/identity/customer';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { toIsoDate } from '../../domain/shared/iso-date';
import { normalisePhone } from '../../domain/shared/phone-number';
import { PortfolioImportProcessor } from '../jobs/portfolio-import.processor';
import type { JobEnvelope } from '../../infrastructure/queue/job-context';
import { MfCentralCallbackService } from './mfcentral-callback.service';
import { PortfolioImportService } from './portfolio-import.service';

const partners = {
  mfcentral: {
    importTtlMinutes: 15,
    redirectUrl: 'http://localhost:3000/v1/integrations/mfcentral/callback',
    returnUrl: 'http://fe.test/onboarding/portfolio-import',
  },
};
const partnersCfg = partners as never;

const statement = JSON.stringify({
  data: {
    asOf: '2026-10-18',
    investor: { name: 'VINOD' },
    folios: [
      {
        amc: 'A',
        folio: '1234567',
        schemes: [
          {
            schemeName: 'A Flexi Cap',
            schemeType: 'Equity',
            units: 10,
            nav: 20,
            costValue: 150,
          },
        ],
      },
    ],
  },
});

function build() {
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    customers: new FakeCustomers((p) => `fp:${p}`),
    identities: new FakeIdentities((p) => `fp:${p}`),
    kyc: new FakeKycRecords(),
    portfolio: new FakePortfolio(),
    mfcentral: new FakeMfCentral(),
    storage: new FakeStorage(),
    inbox: new FakeInbox(),
    jobs: new FakeJobs(),
    audit: new FakeAudit(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
  };
  const app = completeStep(
    completeStep(
      completeStep(
        newApplication('app_1', 'cus_1', now),
        'EMAIL_VERIFIED',
        'ELIGIBILITY',
        now,
      ),
      'ELIGIBILITY',
      'PAN_IDENTITY',
      now,
    ),
    'IDENTITY',
    'PORTFOLIO_IMPORT',
    now,
  );
  void d.applications.create(app);
  let customer = verifyPhone(
    newProvisionalCustomer('cus_1', normalisePhone('9876543210'), now),
    now,
  );
  customer = verifyEmail(
    proposeEmail(customer, 'v@example.com'),
    'v@example.com',
    now,
  );
  void d.customers.create(customer);
  void d.identities.append({
    applicationId: 'app_1',
    version: 1,
    pan: 'ABCPE1234F',
    legalName: 'Vinod',
    dateOfBirth: toIsoDate('1990-01-15'),
    permissionVersion: 'v',
    status: 'SUBMITTED',
    submittedAt: now,
  });
  const service = new PortfolioImportService(
    d.uow,
    d.applications,
    d.customers,
    d.identities,
    d.kyc,
    d.portfolio,
    d.mfcentral,
    d.audit,
    d.analytics,
    d.clock,
    d.ids,
    partnersCfg,
  );
  const callback = new MfCentralCallbackService(
    d.portfolio,
    d.inbox,
    d.jobs,
    partnersCfg,
    silentLogger as never,
  );
  const processor = new PortfolioImportProcessor(
    new CorrelationStore(),
    silentLogger as never,
    d.uow,
    d.applications,
    d.portfolio,
    d.identities,
    d.inbox,
    d.mfcentral,
    d.storage,
    d.audit,
    d.analytics,
    d.clock,
    d.ids,
    service,
  );
  const job = (payload: unknown) =>
    ({ id: 'j1', data: { correlationId: 'c', payload } }) as unknown as Job<
      JobEnvelope<never>
    >;
  const cmd = { applicationId: 'app_1', customerId: 'cus_1' };
  return { d, service, callback, processor, job, cmd, now };
}

describe('PortfolioImportService.start', () => {
  it('creates one CAS request with PAN, mobile and verified email; a second start returns the open import', async () => {
    const { d, service, cmd, now } = build();
    const r = await service.start({ ...cmd, consent: true });
    expect(r).toEqual({
      importId: 'pi_1',
      status: 'AWAITING_AUTHORISATION',
      failureCategory: undefined,
      authorisationUrl:
        'http://mfc.test/investor?reqId=4000000001&clientRefNo=pi_1',
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(d.mfcentral.requests[0]).toEqual({
      clientRefNo: 'pi_1',
      pan: 'ABCPE1234F',
      mobile: '+919876543210',
      email: 'v@example.com',
      redirectUrl: partners.mfcentral.redirectUrl,
    });
    const again = await service.start({ ...cmd, consent: true });
    expect(again.importId).toBe('pi_1');
    expect(d.mfcentral.requests).toHaveLength(1);
    expect(d.analytics.events).toEqual([
      expect.objectContaining({
        name: 'Portfolio Import Started',
        screenId: '06A',
        outcome: 'requested',
      }),
    ]);
    expect(
      JSON.stringify(d.analytics.events) + JSON.stringify(d.audit.events),
    ).not.toContain('ABCPE1234F');
  });

  it('a vendor rejection is stored as FAILED provider_rejected; a transport failure records nothing', async () => {
    const { d, service, cmd } = build();
    d.mfcentral.failWith = new PartnerRejectedError('mfcentral', '422');
    const r = await service.start({ ...cmd, consent: true });
    expect(r).toMatchObject({
      status: 'FAILED',
      failureCategory: 'provider_rejected',
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(d.portfolio.imports.get(r.importId)?.status).toBe('FAILED');
    d.mfcentral.failWith = new DependencyUnavailableError();
    await expect(
      service.start({ ...cmd, consent: true }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(d.portfolio.imports.size).toBe(1);
    // a FAILED import is not open, so the next consent starts a fresh request
    d.mfcentral.failWith = undefined;
    const fresh = await service.start({ ...cmd, consent: true });
    expect(fresh.status).toBe('AWAITING_AUTHORISATION');
    expect(fresh.importId).not.toBe(r.importId);
  });

  it('validates consent, ownership, identity step and application status', async () => {
    const { d, service, cmd } = build();
    await expect(
      service.start({ ...cmd, consent: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.start({ ...cmd, customerId: 'cus_2', consent: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    void d.applications.create(newApplication('app_2', 'cus_1', d.clock.now()));
    await expect(
      service.start({ ...cmd, applicationId: 'app_2', consent: true }),
    ).rejects.toMatchObject({
      details: { missingStep: 'IDENTITY' },
    });
    d.identities.rows.length = 0;
    await expect(
      service.start({ ...cmd, consent: true }),
    ).rejects.toMatchObject({
      details: { reason: 'identity_unavailable' },
    });
  });

  it('get reflects expiry without writing and refuses other applications; skip completes the step', async () => {
    const { d, service, cmd } = build();
    const r = await service.start({ ...cmd, consent: true });
    expect(await service.get({ ...cmd, importId: r.importId })).toMatchObject({
      status: 'AWAITING_AUTHORISATION',
    });
    await expect(
      service.get({ ...cmd, importId: 'pi_nope' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    d.clock.advance(16 * 60_000);
    expect(await service.get({ ...cmd, importId: r.importId })).toMatchObject({
      status: 'EXPIRED',
      failureCategory: 'expired',
      authorisationUrl: undefined,
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(d.portfolio.imports.get(r.importId)?.status).toBe(
      'AWAITING_AUTHORISATION',
    );
    expect(await service.skip(cmd)).toEqual({
      status: 'SKIPPED',
      nextScreen: 'KYC_PROGRESS',
    });
    expect(d.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'KYC_PROGRESS',
    });
    expect(
      d.applications.rows
        .get('app_1')
        ?.steps.some(
          (s) => s.stepId === 'PORTFOLIO_IMPORT' && s.status === 'COMPLETE',
        ),
    ).toBe(true);
    expect(await service.portfolio(cmd)).toEqual({
      status: 'SKIPPED',
      importId: r.importId,
      nextScreen: 'KYC_PROGRESS',
    });
    expect(d.analytics.events.map((e) => e.name)).toContain(
      'Portfolio Import Skipped',
    );
  });

  it('skip with no import creates a SKIPPED row and follows the KYC outcome; skip after import is refused', async () => {
    const { d, service, cmd } = build();
    void d.kyc.create({
      id: 'kyc_1',
      applicationId: 'app_1',
      identityVersion: 1,
      provider: 'DIGIO_KRA',
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REUSE',
      operationId: 'op_1',
      version: 1,
      updatedAt: d.clock.now(),
    });
    expect(await service.skip(cmd)).toEqual({
      status: 'SKIPPED',
      nextScreen: 'CONFIRM_KYC',
    });
    expect([...d.portfolio.imports.values()][0]).toMatchObject({
      status: 'SKIPPED',
    });
    expect(await service.skip(cmd)).toEqual({
      status: 'SKIPPED',
      nextScreen: 'CONFIRM_KYC',
    });
    expect(d.portfolio.imports.size).toBe(1);
    expect(await service.portfolio(cmd)).toMatchObject({ status: 'SKIPPED' });
    d.portfolio.imports.set('pi_x', {
      ...[...d.portfolio.imports.values()][0],
      id: 'pi_x',
      status: 'IMPORTED',
      createdAt: new Date(d.clock.now().getTime() + 1),
    });
    await expect(service.skip(cmd)).rejects.toMatchObject({
      details: { reason: 'already_imported' },
    });
    expect(await service.portfolio(cmd)).toMatchObject({
      status: 'NOT_AVAILABLE',
      importId: 'pi_x',
    });
  });
});

describe('MfCentralCallbackService + PortfolioImportProcessor', () => {
  it('stores the callback once, queues completion, redirects to the FE; the worker imports and advances', async () => {
    const { d, service, callback, processor, job, cmd } = build();
    const started = await service.start({ ...cmd, consent: true });
    d.mfcentral.plaintexts.set('CIPHER', statement);
    const r = await callback.receive({
      reqId: '4000000001',
      clientRefNo: 'pi_1',
      status: 'SUCCESS',
      response: 'CIPHER',
    });
    expect(r).toEqual({
      redirectTo:
        'http://fe.test/onboarding/portfolio-import?import_id=pi_1&status=received',
      importId: 'pi_1',
      duplicate: false,
    });
    expect(d.jobs.published).toEqual([
      {
        queue: 'portfolio-import',
        name: 'complete',
        payload: { importId: 'pi_1', inboxId: 'inbox_1' },
        opts: { jobId: 'inbox-inbox_1' },
      },
    ]);
    expect(
      (
        await callback.receive({
          clientRefNo: 'pi_1',
          status: 'SUCCESS',
          response: 'CIPHER',
        })
      ).duplicate,
    ).toBe(true);
    expect(d.jobs.published).toHaveLength(1);
    expect(await callback.receive({ clientRefNo: 'pi_other' })).toEqual({
      redirectTo: 'http://fe.test/onboarding/portfolio-import?status=unknown',
      duplicate: false,
    });
    expect(d.inbox.rows.size).toBe(1);

    await processor.handle({ importId: 'pi_1', inboxId: 'inbox_1' }, job({}));
    expect(d.portfolio.imports.get('pi_1')).toMatchObject({
      status: 'IMPORTED',
    });
    const snap = [...d.portfolio.snapshots.values()][0];
    expect(snap).toMatchObject({
      importId: 'pi_1',
      evidenceKey: 'portfolio/app_1/pi_1/cas.json',
      data: {
        investor: { panMasked: 'AB••••••4F' },
        totals: { marketValueInr: 200, costValueInr: 150, gainInr: 50 },
      },
    });
    expect(d.storage.objects.has('portfolio/app_1/pi_1/cas.json')).toBe(true);
    expect(d.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'KYC_PROGRESS',
    });
    expect(d.inbox.rows.get('inbox_1')?.status).toBe('PROCESSED');
    expect(
      await service.get({ ...cmd, importId: started.importId }),
    ).toMatchObject({ status: 'IMPORTED', nextScreen: 'ASSETS_DASHBOARD' });
    expect(await service.portfolio(cmd)).toMatchObject({
      status: 'AVAILABLE',
      importId: 'pi_1',
      nextScreen: 'KYC_PROGRESS',
    });
    const completed = d.analytics.events.filter(
      (e) => e.name === 'Portfolio Import Completed',
    );
    expect(completed).toEqual([
      expect.objectContaining({ outcome: 'imported', screenId: '06A' }),
    ]);
    expect(JSON.stringify(d.analytics.events)).not.toMatch(/1234567|200|ABCPE/);

    // replay: same job twice → one snapshot, one event
    await processor.handle({ importId: 'pi_1', inboxId: 'inbox_1' }, job({}));
    d.inbox.rows.get('inbox_1')!.status = 'RECEIVED';
    await processor.handle({ importId: 'pi_1', inboxId: 'inbox_1' }, job({}));
    expect(d.portfolio.snapshots.size).toBe(1);
    expect(
      d.analytics.events.filter((e) => e.name === 'Portfolio Import Completed'),
    ).toHaveLength(1);
    expect(d.inbox.rows.get('inbox_1')?.status).toBe('PROCESSED');
  });

  it('a declined consent moves the journey on; an undecryptable statement is FAILED and keeps the customer on the screen', async () => {
    const { d, service, callback, processor, job, cmd } = build();
    await service.start({ ...cmd, consent: true });
    await callback.receive({
      clientRefNo: 'pi_1',
      status: 'FAILED',
      errorMessage: 'declined',
    });
    await processor.handle({ importId: 'pi_1', inboxId: 'inbox_1' }, job({}));
    expect(d.portfolio.imports.get('pi_1')).toMatchObject({
      status: 'DECLINED',
      failureCategory: 'authorisation_declined',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('KYC_PROGRESS');
    expect(d.mfcentral.requests).toHaveLength(1);
    expect(d.portfolio.snapshots.size).toBe(0);

    // second import after decline, this time with a payload we cannot decrypt
    const second = await service.start({ ...cmd, consent: true });
    expect(second.status).toBe('AWAITING_AUTHORISATION');
    await callback.receive({
      clientRefNo: second.importId,
      status: 'SUCCESS',
      response: 'GARBAGE',
    });
    await processor.handle(
      { importId: second.importId, inboxId: 'inbox_2' },
      job({}),
    );
    expect(d.portfolio.imports.get(second.importId)).toMatchObject({
      status: 'FAILED',
      failureCategory: 'invalid_payload',
    });
    expect(d.storage.objects.size).toBe(0);
    expect(
      await service.get({ ...cmd, importId: second.importId }),
    ).toMatchObject({ nextScreen: 'KYC_PROGRESS' }); // step completed by the decline
    // a payload that decrypts but is not a statement
    const third = await service.start({ ...cmd, consent: true });
    d.mfcentral.plaintexts.set('X', JSON.stringify({ reqId: '1' }));
    await callback.receive({ clientRefNo: third.importId, response: 'X' });
    await processor.handle(
      { importId: third.importId, inboxId: 'inbox_3' },
      job({}),
    );
    expect(d.portfolio.imports.get(third.importId)).toMatchObject({
      status: 'FAILED',
      failureCategory: 'invalid_payload',
    });
    expect(
      d.analytics.events
        .filter((e) => e.name === 'Portfolio Import Completed')
        .map((e) => [e.outcome, e.safeErrorCategory]),
    ).toEqual([
      ['declined', 'authorisation_declined'],
      ['failed', 'invalid_payload'],
      ['failed', 'invalid_payload'],
    ]);
  });

  it('terminal imports only acknowledge the inbox; an empty payload is invalid; a missing application is a no-op', async () => {
    const { d, service, callback, processor, job, cmd } = build();
    const first = await service.start({ ...cmd, consent: true });
    await callback.receive({
      clientRefNo: first.importId,
      status: 'SUCCESS',
      response: 'X',
    });
    d.portfolio.imports.set(first.importId, {
      ...d.portfolio.imports.get(first.importId)!,
      status: 'SKIPPED',
    });
    await processor.handle(
      { importId: first.importId, inboxId: 'inbox_1' },
      job({}),
    );
    expect(d.inbox.rows.get('inbox_1')?.status).toBe('PROCESSED');
    expect(d.portfolio.imports.get(first.importId)?.status).toBe('SKIPPED');

    const second = await service.start({ ...cmd, consent: true });
    await callback.receive({ clientRefNo: second.importId });
    d.inbox.rows.get('inbox_2')!.payload = undefined;
    await processor.handle(
      { importId: second.importId, inboxId: 'inbox_2' },
      job({}),
    );
    expect(d.portfolio.imports.get(second.importId)).toMatchObject({
      status: 'FAILED',
      failureCategory: 'invalid_payload',
    });

    const third = await service.start({ ...cmd, consent: true });
    d.mfcentral.plaintexts.set('S', statement);
    await callback.receive({ clientRefNo: third.importId, response: 'S' });
    d.applications.rows.clear();
    await processor.handle(
      { importId: third.importId, inboxId: 'inbox_3' },
      job({}),
    );
    expect(d.portfolio.imports.get(third.importId)?.status).toBe(
      'AWAITING_AUTHORISATION',
    );
    expect(d.portfolio.snapshots.size).toBe(0);
    expect(d.inbox.rows.get('inbox_3')?.status).toBe('PROCESSED');
    // lower-case parameter names are accepted too
    expect(
      (await callback.receive({ clientrefno: third.importId, reqid: '1' }))
        .duplicate,
    ).toBe(true);
  });

  it('read-only views work on a non-active application while mutations refuse', async () => {
    const { d, service, cmd } = build();
    const r = await service.start({ ...cmd, consent: true });
    d.applications.rows.set('app_1', {
      ...d.applications.rows.get('app_1')!,
      status: 'ASSISTED',
    });
    expect(await service.get({ ...cmd, importId: r.importId })).toMatchObject({
      status: 'AWAITING_AUTHORISATION',
    });
    expect(await service.portfolio(cmd)).toMatchObject({
      status: 'NOT_AVAILABLE',
    });
    await expect(
      service.start({ ...cmd, consent: true }),
    ).rejects.toMatchObject({ details: { applicationStatus: 'ASSISTED' } });
    await expect(service.skip(cmd)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a vendor answer without a request id is treated as a rejection', async () => {
    const { d, service, cmd } = build();
    d.mfcentral.newCasRequest = () => Promise.resolve({ raw: {} });
    expect(await service.start({ ...cmd, consent: true })).toMatchObject({
      status: 'FAILED',
      failureCategory: 'provider_rejected',
    });
  });

  it('ignores unknown imports or inbox rows and marks the inbox failed when the import throws', async () => {
    const { d, service, callback, processor, job, cmd } = build();
    await processor.handle(
      { importId: 'pi_nope', inboxId: 'inbox_nope' },
      job({}),
    );
    await service.start({ ...cmd, consent: true });
    d.mfcentral.plaintexts.set('CIPHER', statement);
    await callback.receive({
      clientRefNo: 'pi_1',
      status: 'SUCCESS',
      response: 'CIPHER',
    });
    d.storage.put = () => Promise.reject(new Error('minio down'));
    await expect(
      processor.handle({ importId: 'pi_1', inboxId: 'inbox_1' }, job({})),
    ).rejects.toThrow('minio down');
    expect(d.inbox.rows.get('inbox_1')?.status).toBe('FAILED');
    expect(d.portfolio.imports.get('pi_1')?.status).toBe(
      'AWAITING_AUTHORISATION',
    );
  });
});
