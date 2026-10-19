import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeCustomers,
  FakeIdentities,
  FakeKycRecords,
  FakeMfCentral,
  FakePortfolio,
  FakeStorage,
  FakeUow,
  FixedClock,
  SeqIds,
  silentLogger,
} from '../../../test/support/fakes';
import {
  DependencyUnavailableError,
  NotFoundError,
  PartnerRejectedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  newProvisionalCustomer,
  proposeEmail,
  verifyEmail,
  verifyPhone,
} from '../../domain/identity/customer';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { toIsoDate } from '../../domain/shared/iso-date';
import { normalisePhone } from '../../domain/shared/phone-number';
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
const QR =
  'iVBORw0KGgoAAAANSUhEUgAAAPoAAAD6AQAAAACgl2eQAAACP0lEQVR4Xu2YQW6DQAxFjVjMkiPMTcLFIhWJiw03mSNkyQLh';

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
    pan: 'AQQPS7576R',
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
    d.storage,
    d.audit,
    d.analytics,
    d.clock,
    d.ids,
    partnersCfg,
  );
  const callback = new MfCentralCallbackService(
    service,
    partnersCfg,
    silentLogger as never,
  );
  const cmd = { applicationId: 'app_1', customerId: 'cus_1' };
  return { d, service, callback, cmd, now };
}

describe('PortfolioImportService.start', () => {
  it('registers one CAS request (mobile only) and hands off with the encrypted payload; a second start reuses it', async () => {
    const { d, service, cmd, now } = build();
    const r = await service.start({ ...cmd, consent: true });
    expect(r).toEqual({
      importId: 'pi_1',
      status: 'AWAITING_AUTHORISATION',
      failureCategory: undefined,
      lastError: undefined,
      authorisationUrl:
        'http://mfc.test/api/auth/start?data=3400001.otp-3400001.pi_1',
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(d.mfcentral.requests[0]).toEqual({
      clientRefNo: 'pi_1',
      pan: 'AQQPS7576R',
      mobile: '+919876543210',
      email: undefined,
      redirectUrl: partners.mfcentral.redirectUrl,
    });
    expect(d.portfolio.imports.get('pi_1')).toMatchObject({
      providerRequestId: '3400001',
    });
    expect((await service.start({ ...cmd, consent: true })).importId).toBe(
      'pi_1',
    );
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
    ).not.toContain('AQQPS7576R');
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
    d.mfcentral.failWith = new DependencyUnavailableError();
    await expect(
      service.start({ ...cmd, consent: true }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(d.portfolio.imports.size).toBe(1);
    d.mfcentral.failWith = undefined;
    const fresh = await service.start({ ...cmd, consent: true });
    expect(fresh.status).toBe('AWAITING_AUTHORISATION');
    expect(fresh.importId).not.toBe(r.importId);
    d.mfcentral.newCasRequest = () => Promise.resolve({ raw: {} });
    d.portfolio.imports.clear();
    expect(await service.start({ ...cmd, consent: true })).toMatchObject({
      status: 'FAILED',
      failureCategory: 'provider_rejected',
    });
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
    ).rejects.toMatchObject({ details: { missingStep: 'IDENTITY' } });
    d.identities.rows.length = 0;
    await expect(
      service.start({ ...cmd, consent: true }),
    ).rejects.toMatchObject({ details: { reason: 'identity_unavailable' } });
    d.applications.rows.set('app_1', {
      ...d.applications.rows.get('app_1')!,
      status: 'ASSISTED',
    });
    await expect(
      service.start({ ...cmd, consent: true }),
    ).rejects.toMatchObject({ details: { applicationStatus: 'ASSISTED' } });
    expect(await service.portfolio(cmd)).toMatchObject({
      status: 'NOT_AVAILABLE',
    });
  });
});

describe('return leg, QR validation, skip, dashboard', () => {
  it('callback marks the import AWAITING_QR; the QR upload imports the statement and advances the journey', async () => {
    const { d, service, callback, cmd } = build();
    const started = await service.start({ ...cmd, consent: true });
    const back = await callback.receive({
      status: 'success',
      reqId: '3400001',
      type: 'Summary',
    });
    expect(back).toEqual({
      redirectTo:
        'http://fe.test/onboarding/portfolio-import?import_id=pi_1&status=awaiting_qr',
      importId: 'pi_1',
    });
    expect(await service.get({ ...cmd, importId: 'pi_1' })).toMatchObject({
      status: 'AWAITING_QR',
      authorisationUrl: expect.any(String) as string,
    });
    // replayed return is a no-op
    expect(
      (await callback.receive({ status: 'success', reqId: '3400001' }))
        .importId,
    ).toBe('pi_1');
    expect(await callback.receive({ status: 'success', reqId: '999' })).toEqual(
      {
        redirectTo: 'http://fe.test/onboarding/portfolio-import?status=unknown',
      },
    );
    expect(await callback.receive({ nothing: true })).toEqual({
      redirectTo: 'http://fe.test/onboarding/portfolio-import?status=invalid',
    });

    const done = await service.validateQr({
      ...cmd,
      importId: started.importId,
      qrCode: `data:image/png;base64,${QR}`,
    });
    expect(done).toMatchObject({
      status: 'IMPORTED',
      nextScreen: 'ASSETS_DASHBOARD',
      lastError: undefined,
    });
    expect(d.mfcentral.qrRequests[0]).toEqual({
      clientRefNo: 'pi_1',
      reqId: '3400001',
      qrCode: QR,
    });
    expect(d.storage.objects.has('portfolio/app_1/pi_1/cas.json')).toBe(true);
    const snap = [...d.portfolio.snapshots.values()][0];
    expect(snap.data).toMatchObject({
      investor: { panMasked: 'AQ••••••6R' },
      partial: true,
    });
    expect(snap.data.holdings).toHaveLength(7);
    expect(d.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'KYC_PROGRESS',
    });
    expect(await service.portfolio(cmd)).toMatchObject({
      status: 'AVAILABLE',
      importId: 'pi_1',
      nextScreen: 'KYC_PROGRESS',
    });
    expect(
      d.analytics.events.filter((e) => e.name === 'Portfolio Import Completed'),
    ).toEqual([
      expect.objectContaining({ outcome: 'imported', screenId: '06A' }),
    ]);
    expect(JSON.stringify(d.analytics.events)).not.toMatch(
      /17057225|AQQPS|21009690/,
    );
    // a second upload after import is idempotent; a replayed snapshot write changes nothing
    expect(
      (await service.validateQr({ ...cmd, importId: 'pi_1', qrCode: QR }))
        .status,
    ).toBe('IMPORTED');
    expect(d.mfcentral.qrRequests).toHaveLength(1);
    expect(d.portfolio.snapshots.size).toBe(1);
  });

  it('the QR can be uploaded before the return leg arrives; MF Central rejecting it keeps the import open with the message', async () => {
    const { d, service, cmd } = build();
    const started = await service.start({ ...cmd, consent: true });
    d.mfcentral.qrFailWith = new PartnerRejectedError(
      'mfcentral',
      '422',
      undefined,
      {
        details: {
          vendorErrors: [
            { code: '422', message: 'Failed to Validate QR code' },
          ],
        },
      },
    );
    await expect(
      service.validateQr({ ...cmd, importId: started.importId, qrCode: QR }),
    ).rejects.toMatchObject({
      message: 'Failed to Validate QR code',
      details: { reason: 'qr_invalid', importId: 'pi_1' },
    });
    expect(await service.get({ ...cmd, importId: 'pi_1' })).toMatchObject({
      status: 'AWAITING_AUTHORISATION',
      lastError: 'Failed to Validate QR code',
    });
    d.mfcentral.qrFailWith = new PartnerRejectedError('mfcentral', '422');
    await expect(
      service.validateQr({ ...cmd, importId: 'pi_1', qrCode: QR }),
    ).rejects.toMatchObject({ message: 'QR code not accepted' });
    d.mfcentral.qrFailWith = new DependencyUnavailableError();
    await expect(
      service.validateQr({ ...cmd, importId: 'pi_1', qrCode: QR }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    d.mfcentral.qrFailWith = undefined;
    expect(
      (await service.validateQr({ ...cmd, importId: 'pi_1', qrCode: QR }))
        .status,
    ).toBe('IMPORTED');
    await expect(
      service.validateQr({ ...cmd, importId: 'pi_nope', qrCode: QR }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a statement that cannot be parsed fails the import; an expired import cannot take a QR', async () => {
    const { d, service, cmd } = build();
    const started = await service.start({ ...cmd, consent: true });
    d.mfcentral.statement = { reqId: '1' };
    expect(
      await service.validateQr({
        ...cmd,
        importId: started.importId,
        qrCode: QR,
      }),
    ).toMatchObject({
      status: 'FAILED',
      failureCategory: 'invalid_payload',
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(d.storage.objects.size).toBe(0);
    const second = await service.start({ ...cmd, consent: true });
    d.clock.advance(16 * 60_000);
    expect(
      await service.get({ ...cmd, importId: second.importId }),
    ).toMatchObject({
      status: 'EXPIRED',
      failureCategory: 'expired',
      authorisationUrl: undefined,
    });
    await expect(
      service.validateQr({ ...cmd, importId: second.importId, qrCode: QR }),
    ).rejects.toMatchObject({
      details: { reason: 'import_not_open', status: 'EXPIRED' },
    });
  });

  it('a declined consent completes the step and follows the KYC outcome', async () => {
    const { d, service, callback, cmd } = build();
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
    await service.start({ ...cmd, consent: true });
    const back = await callback.receive({
      status: 'error',
      reqId: '3400001',
      code: 'ERR_USER_DECLINED',
      message: 'Investor declined consent',
    });
    expect(back.redirectTo).toBe(
      'http://fe.test/onboarding/portfolio-import?import_id=pi_1&status=declined',
    );
    expect(d.portfolio.imports.get('pi_1')).toMatchObject({
      status: 'DECLINED',
      failureCategory: 'authorisation_declined',
      lastError: 'Investor declined consent',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('CONFIRM_KYC');
    expect(await service.get({ ...cmd, importId: 'pi_1' })).toMatchObject({
      status: 'DECLINED',
      nextScreen: 'CONFIRM_KYC',
    });
    expect(d.analytics.events.map((e) => [e.name, e.outcome])).toContainEqual([
      'Portfolio Import Completed',
      'declined',
    ]);
    // an error without reqId cannot be matched; a late error on a closed import is ignored
    expect(
      await callback.receive({ status: 'error', code: 'ERR_SESSION' }),
    ).toEqual({
      redirectTo: 'http://fe.test/onboarding/portfolio-import?status=unknown',
    });
    expect(
      (await callback.receive({ status: 'error', reqId: '3400001' }))
        .redirectTo,
    ).toContain('status=declined');
    // the customer may consent again afterwards
    expect((await service.start({ ...cmd, consent: true })).status).toBe(
      'AWAITING_AUTHORISATION',
    );
  });

  it('skip cancels an open import or records a SKIPPED row, and is refused after an import', async () => {
    const { d, service, cmd } = build();
    const r = await service.start({ ...cmd, consent: true });
    expect(await service.skip(cmd)).toEqual({
      status: 'SKIPPED',
      nextScreen: 'KYC_PROGRESS',
    });
    expect(d.portfolio.imports.get(r.importId)?.status).toBe('SKIPPED');
    expect(await service.portfolio(cmd)).toEqual({
      status: 'SKIPPED',
      importId: r.importId,
      nextScreen: 'KYC_PROGRESS',
    });
    expect(await service.skip(cmd)).toEqual({
      status: 'SKIPPED',
      nextScreen: 'KYC_PROGRESS',
    });
    expect(d.portfolio.imports.size).toBe(1);
    d.portfolio.imports.clear();
    expect(await service.skip(cmd)).toEqual({
      status: 'SKIPPED',
      nextScreen: 'KYC_PROGRESS',
    });
    expect([...d.portfolio.imports.values()][0]).toMatchObject({
      status: 'SKIPPED',
    });
    d.portfolio.imports.set('pi_x', {
      ...[...d.portfolio.imports.values()][0],
      id: 'pi_x',
      status: 'IMPORTED',
      createdAt: new Date(d.clock.now().getTime() + 1),
    });
    await expect(service.skip(cmd)).rejects.toMatchObject({
      details: { reason: 'already_imported' },
    });
    expect(
      d.analytics.events.filter((e) => e.name === 'Portfolio Import Skipped'),
    ).toHaveLength(3);
  });
});
