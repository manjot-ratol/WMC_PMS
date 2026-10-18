import {
  FakeAccountOpening,
  FakeAudit,
  FakeInbox,
  FakeJobs,
  FakeKycSessions,
  FakeSigning,
  FixedClock,
  silentLogger,
} from '../../../test/support/fakes';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DigioWebhookProcessor,
  findSignDocumentId,
} from './digio-webhook.processor';

describe('DigioWebhookProcessor (Phase 6 dispatch)', () => {
  function build() {
    const d = {
      inbox: new FakeInbox(),
      sessions: new FakeKycSessions(),
      jobs: new FakeJobs(),
      audit: new FakeAudit(),
      signing: new FakeSigning(),
      accounts: new FakeAccountOpening(),
      clock: new FixedClock(),
    };
    const p = new DigioWebhookProcessor(
      new CorrelationStore(),
      silentLogger as never,
      d.inbox,
      d.sessions,
      d.jobs,
      d.audit,
      d.signing,
      d.accounts,
      d.clock,
    );
    return { d, p };
  }
  const now = new Date();

  it('a DigiSign event for a known document queues an immediate status poll; unknown documents are only logged', async () => {
    const { d, p } = build();
    await d.signing.create({
      id: 'ss_1',
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      signingMethod: 'AADHAAR_ESIGN',
      status: 'REQUESTED',
      providerRequestId: 'DID123',
      packObjectKey: 'k',
      packSha256: 'h',
      documents: [],
      pollCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const { id } = await d.inbox.insertIfNew('digio', 'evt1', {
      id: 'evt1',
      event: 'DOC.SIGNED',
      entities: ['document'],
      payload: { document: { id: 'DID123', agreement_status: 'completed' } },
    });
    await p.handle({ inboxId: id });
    expect(d.jobs.published).toEqual([
      {
        queue: 'signing-status',
        name: 'poll',
        payload: { signingSessionId: 'ss_1' },
        opts: { jobId: 'ss_1-wh-evt1' },
      },
    ]);
    expect(d.inbox.rows.get(id)?.status).toBe('PROCESSED');
    const unknown = await d.inbox.insertIfNew('digio', 'evt2', {
      id: 'evt2',
      event: 'DOC.SIGNED',
      entities: ['document'],
      payload: { document: { id: 'DID999' } },
    });
    await p.handle({ inboxId: unknown.id });
    expect(d.jobs.published).toHaveLength(1);
    expect(
      findSignDocumentId({ payload: { x: { id: 'KID1' }, y: { id: 'DID7' } } }),
    ).toBe('DID7');
    expect(findSignDocumentId({ payload: {} })).toBeUndefined();
  });

  it('KRA status updates apply to the correlated submission and never regress it', async () => {
    const { d, p } = build();
    const base = {
      id: 'rs_1',
      applicationId: 'app_1',
      runId: 'ao_1',
      registry: 'KRA' as const,
      status: 'SUBMITTED' as const,
      providerRequestId: 'KRAREQ1',
      clientReferenceId: 'rs_1',
      createdAt: now,
      updatedAt: now,
    };
    await d.accounts.createSubmission(base);
    const ev = async (
      key: string,
      status: string,
      ref: Record<string, string>,
    ) => {
      const { id } = await d.inbox.insertIfNew('digio', key, {
        id: key,
        event: 'KRA.PAN.STATUS.UPDATE',
        entities: ['kra_register'],
        payload: { kra_register: { status, ...ref } },
      });
      await p.handle({ inboxId: id });
    };
    await ev('k1', 'KRA_VALIDATED', { request_id: 'KRAREQ1' });
    expect(d.accounts.submissions[0]).toMatchObject({
      status: 'VALIDATED',
      lastProviderStatus: 'KRA_VALIDATED',
    });
    await ev('k2', 'SUBMITTED', { client_reference_id: 'rs_1' });
    expect(d.accounts.submissions[0].status).toBe('VALIDATED');
    expect(d.audit.events.at(-1)?.action).toBe(
      'webhook.kra_register_regression_ignored',
    );
    await ev('k3', 'KRA_VERIFIED', { request_id: 'NOPE' });
    expect(d.accounts.submissions[0].status).toBe('VALIDATED');
  });
});
