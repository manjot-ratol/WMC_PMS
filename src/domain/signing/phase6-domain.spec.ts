import { ValidationError } from '../../common/errors/app-error';
import {
  accountsReady,
  isRegistryRegression,
  kraRegistrationRequired,
  loadAccountOpeningRulebook,
  mapKraStatus,
} from '../account-opening/account-opening';
import {
  activationStatusFor,
  evaluateActivationGates,
  loadActivationRulebook,
} from '../activation/activation';
import {
  fillPlaceholders,
  loadDocumentTemplate,
  renderTemplateText,
} from '../documents/document-templates';
import {
  fundingStatusFor,
  loadFundingRulebook,
  paymentReference,
  reconcileReceipt,
  validateFundingMethod,
} from '../funding/funding';
import { completeStep, newApplication } from '../onboarding/application';
import { evaluateSignStatus, signingNextScreen } from './signing-session';

describe('evaluateSignStatus', () => {
  it('executes only on completed + every party signed; requested is never completion', () => {
    expect(
      evaluateSignStatus({
        agreementStatus: 'completed',
        signers: [{ status: 'signed' }],
      }),
    ).toEqual({ outcome: 'EXECUTED' });
    expect(
      evaluateSignStatus({
        agreementStatus: 'requested',
        signers: [{ status: 'signed' }],
      }),
    ).toEqual({ outcome: 'PENDING', status: 'IN_PROGRESS' });
    expect(
      evaluateSignStatus({
        agreementStatus: 'requested',
        signers: [{ status: 'requested' }],
      }),
    ).toEqual({ outcome: 'PENDING', status: 'REQUESTED' });
    expect(
      evaluateSignStatus({ agreementStatus: 'completed', signers: [] }),
    ).toEqual({ outcome: 'PENDING', status: 'REQUESTED' });
    expect(
      evaluateSignStatus({
        agreementStatus: 'completed',
        signers: [{ status: 'signed' }, { status: 'requested' }],
      }),
    ).toMatchObject({ outcome: 'PENDING' });
  });
  it('maps expiry, failure and cancellation to terminal states', () => {
    expect(
      evaluateSignStatus({
        agreementStatus: 'expired',
        signers: [{ status: 'requested' }],
      }),
    ).toMatchObject({ outcome: 'TERMINAL', status: 'EXPIRED' });
    expect(
      evaluateSignStatus({ agreementStatus: 'failed', signers: [] }),
    ).toMatchObject({ outcome: 'TERMINAL', status: 'FAILED' });
    expect(
      evaluateSignStatus({
        agreementStatus: 'requested',
        signers: [{ status: 'cancelled' }],
      }),
    ).toMatchObject({ outcome: 'TERMINAL', status: 'CANCELLED' });
    expect(
      evaluateSignStatus({
        agreementStatus: 'requested',
        signers: [{ status: 'failed' }],
      }),
    ).toMatchObject({ status: 'FAILED' });
    expect(signingNextScreen('EXECUTED')).toBe('APPLICATION_PROCESSING');
    expect(signingNextScreen('EXPIRED')).toBe('SIGN_DOCUMENTS');
  });
});

describe('account opening domain', () => {
  const rb = loadAccountOpeningRulebook();
  it('maps KRA statuses conservatively and rejects regressions', () => {
    expect(mapKraStatus('KRA_VERIFIED')).toBe('VERIFIED');
    expect(mapKraStatus('kra_validated')).toBe('VALIDATED');
    expect(mapKraStatus('SUBMITTED')).toBe('SUBMITTED');
    expect(mapKraStatus('NOT_CHECKED_WITH_RESPECTIVE_KRA')).toBe('SUBMITTED');
    expect(mapKraStatus('ON_HOLD')).toBe('ON_HOLD');
    expect(mapKraStatus('DEACTIVATED')).toBe('REJECTED');
    expect(mapKraStatus('SOMETHING_NEW')).toBe('ERROR');
    expect(mapKraStatus(undefined)).toBe('ERROR');
    expect(isRegistryRegression('VALIDATED', 'SUBMITTED')).toBe(true);
    expect(isRegistryRegression('SUBMITTED', 'VERIFIED')).toBe(false);
    expect(isRegistryRegression('VERIFIED', 'VERIFIED')).toBe(false);
  });
  it('KRA registration is needed for fresh and remediated KYC only; readiness needs every required account type', () => {
    expect(kraRegistrationRequired('REUSE')).toBe(false);
    expect(kraRegistrationRequired('FRESH')).toBe(true);
    expect(kraRegistrationRequired('REMEDIATE')).toBe(true);
    expect(
      accountsReady([{ accountType: 'PMS_ACCOUNT', status: 'READY' }], rb),
    ).toBe(false);
    expect(
      accountsReady(
        [
          { accountType: 'PMS_ACCOUNT', status: 'READY' },
          { accountType: 'DEMAT', status: 'PENDING' },
        ],
        rb,
      ),
    ).toBe(false);
    expect(
      accountsReady(
        [
          { accountType: 'PMS_ACCOUNT', status: 'READY' },
          { accountType: 'DEMAT', status: 'READY' },
        ],
        rb,
      ),
    ).toBe(true);
  });
});

describe('funding domain', () => {
  const rb = loadFundingRulebook();
  it('reference is deterministic and customer-safe; method is validated', () => {
    expect(paymentReference('app_0123456789abcdef', 'PMS')).toBe(
      'PMS-89ABCDEF',
    );
    expect(paymentReference('app_0123456789abcdef', 'PMS')).toBe(
      paymentReference('app_0123456789abcdef', 'PMS'),
    );
    expect(() => validateFundingMethod('BANK_TRANSFER', rb)).not.toThrow();
    expect(() => validateFundingMethod('CASH', rb)).toThrow(ValidationError);
  });
  it('a receipt matches only from the verified account, in INR, to our reference', () => {
    const expected = {
      currency: 'INR',
      sourceAccountFingerprint: 'fp1',
      paymentReference: 'PMS-1',
    };
    expect(
      reconcileReceipt(
        {
          amountInr: 100,
          currency: 'INR',
          sourceAccountFingerprint: 'fp1',
          destinationReference: 'PMS-1',
        },
        expected,
      ),
    ).toEqual({ matchStatus: 'MATCHED', reasons: [] });
    expect(
      reconcileReceipt(
        {
          amountInr: 100,
          currency: 'INR',
          sourceAccountFingerprint: 'fp2',
          destinationReference: 'PMS-1',
        },
        expected,
      ),
    ).toEqual({
      matchStatus: 'UNMATCHED',
      reasons: ['source_account_mismatch'],
    });
    expect(
      reconcileReceipt(
        {
          amountInr: 0,
          currency: 'USD',
          sourceAccountFingerprint: 'fp1',
          destinationReference: 'PMS-2',
        },
        expected,
      ).reasons,
    ).toEqual([
      'non_positive_amount',
      'currency_mismatch',
      'reference_mismatch',
    ]);
    expect(
      reconcileReceipt(
        { amountInr: 1, currency: 'INR', destinationReference: 'PMS-1' },
        { ...expected, sourceAccountFingerprint: undefined },
      ).reasons,
    ).toEqual(['no_verified_account']);
  });
  it('status follows qualifying funds against the requirement', () => {
    expect(fundingStatusFor(0, 2_500_000)).toBe('AWAITING_FUNDS');
    expect(fundingStatusFor(1, 2_500_000)).toBe('PARTIAL');
    expect(fundingStatusFor(2_500_000, 2_500_000)).toBe('RECONCILED');
    expect(fundingStatusFor(5, 0)).toBe('PARTIAL');
  });
});

describe('activation gates', () => {
  const rb = loadActivationRulebook();
  const now = new Date();
  let app = newApplication('app_1', 'cus_1', now);
  for (const s of rb.requiredSteps)
    app = completeStep(app, s, 'PORTFOLIO', now);
  const good = {
    app,
    signingStatus: 'EXECUTED',
    accountsReady: true,
    fundingStatus: 'RECONCILED',
    screeningStatus: 'PROCEED',
    amlStatus: 'PROCEED',
    openTaskCategories: [],
    registryStatuses: ['NOT_REQUIRED', 'DEFERRED'],
  };
  it('passes only when every gate passes and reports each blocker once', () => {
    expect(evaluateActivationGates(good, rb)).toEqual({
      ready: true,
      blockers: [],
    });
    const bad = evaluateActivationGates(
      {
        ...good,
        app: newApplication('app_2', 'cus_1', now),
        signingStatus: 'REQUESTED',
        accountsReady: false,
        fundingStatus: 'PARTIAL',
        screeningStatus: 'REVIEW',
        amlStatus: undefined,
        openTaskCategories: ['PEP_EDD', 'PEP_EDD', 'ACCOUNT_SETUP'],
        registryStatuses: ['REJECTED'],
      },
      rb,
    );
    expect(bad.ready).toBe(false);
    expect(bad.blockers).toEqual(
      expect.arrayContaining([
        'step_kyc_incomplete',
        'documents_not_executed',
        'accounts_not_ready',
        'funding_not_reconciled',
        'screening_pending',
        'aml_pending',
        'open_task_pep_edd',
        'registry_rejected',
      ]),
    );
    expect(bad.blockers.filter((b) => b === 'open_task_pep_edd')).toHaveLength(
      1,
    );
    expect(bad.blockers).not.toContain('open_task_account_setup');
  });
  it('status distinguishes in-flight from blocked and active', () => {
    expect(activationStatusFor(app, { ready: true, blockers: [] })).toBe(
      'READY_FOR_ACTIVATION',
    );
    expect(
      activationStatusFor(app, {
        ready: false,
        blockers: ['funding_not_reconciled', 'screening_pending'],
      }),
    ).toBe('NOT_READY');
    expect(
      activationStatusFor(app, {
        ready: false,
        blockers: ['open_task_pep_edd'],
      }),
    ).toBe('BLOCKED');
    expect(
      activationStatusFor(
        { ...app, status: 'ACTIVE' },
        { ready: false, blockers: [] },
      ),
    ).toBe('ACTIVE');
  });
});

describe('document templates', () => {
  it('fills nested placeholders, joins arrays and marks missing values', () => {
    expect(
      fillPlaceholders('Hi {{a.b}} / {{list}} / {{missing}} / {{ a.c }}', {
        a: { b: 'X', c: 0 },
        list: ['p', 'q'],
      }),
    ).toBe('Hi X / p, q / — / 0');
    const t = loadDocumentTemplate('DISCLOSURE', 'disclosure_v1');
    const r = renderTemplateText(t, {
      identity: {
        legalName: 'V',
        panMasked: 'AB••••••4F',
        dateOfBirth: '1990-01-01',
      },
      meta: {
        applicationVersion: 3,
        snapshotId: 'snap_1',
        documentPackVersion: 1,
      },
      approach: { approachCode: 'EQUITY_GROWTH' },
      suitability: { riskProfile: 'GROWTH' },
    });
    expect(r.title).toBe('Disclosure Document');
    expect(r.sections[0].paragraphs[0]).toContain('AB••••••4F');
    expect(r.sections[1].paragraphs[1]).toContain('EQUITY_GROWTH');
    expect(() => loadDocumentTemplate('DISCLOSURE', 'nope_v9')).toThrow();
  });
});
