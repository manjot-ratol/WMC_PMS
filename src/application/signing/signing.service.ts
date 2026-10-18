import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  DOCUMENT_PACK_RULEBOOK,
  type DocumentPackRulebook,
} from '../../domain/documents/document-pack';
import {
  loadDocumentTemplate,
  renderTemplateText,
} from '../../domain/documents/document-templates';
import { requireStep } from '../../domain/onboarding/application';
import type { ReviewSnapshot } from '../../domain/review/review-snapshot';
import { ID_PREFIX } from '../../domain/shared/public-id';
import {
  OPEN_SIGNING_STATUSES,
  signingNextScreen,
  type SigningDocument,
  type SigningMethod,
  type SigningSession,
} from '../../domain/signing/signing-session';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepositoryPort,
} from '../ports/customer.repository.port';
import {
  DOCUMENT_RENDERER,
  type DocumentRendererPort,
} from '../ports/document-renderer.port';
import {
  ESIGN_GATEWAY,
  type EsignGatewayPort,
} from '../ports/esign-gateway.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
} from '../ports/review.repository.port';
import {
  SIGNING_REPOSITORY,
  type SigningRepositoryPort,
} from '../ports/signing.repository.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface CreateSigningSessionCommand {
  applicationId: string;
  customerId: string;
  snapshotId: string;
  documentPackVersion: number;
  signingMethod: SigningMethod;
}
export interface SigningSessionCreated {
  signingSessionId: string;
  status: SigningSession['status'];
  providerRequestId?: string;
  sdkLaunch: { accessToken?: string };
}
export interface SigningSessionView {
  status: SigningSession['status'];
  documentPackVersion: number;
  evidenceAvailable: boolean;
  nextScreen: string;
}
export const SCREEN_SIGNING = '21';
export const SIGNING_EXPIRE_DAYS = 10;

/** Screen 21: render the pack from the frozen snapshot, hash it, and open one Digio sign request per snapshot. */
@Injectable()
export class SigningService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customers: CustomerRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepositoryPort,
    @Inject(SIGNING_REPOSITORY) private readonly signing: SigningRepositoryPort,
    @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentRendererPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(ESIGN_GATEWAY) private readonly esign: EsignGatewayPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(DOCUMENT_PACK_RULEBOOK) private readonly pack: DocumentPackRulebook,
  ) {}

  async create(
    cmd: CreateSigningSessionCommand,
  ): Promise<SigningSessionCreated> {
    const app = await this.applications.findById(cmd.applicationId);
    if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
    if (app.status !== 'IN_PROGRESS')
      throw new ValidationError(undefined, {
        details: { applicationStatus: app.status },
      });
    requireStep(app, 'REVIEW');
    const snapshot = await this.reviews.current(app.id);
    if (!snapshot || snapshot.id !== cmd.snapshotId)
      throw new StaleVersionError(undefined, {
        details: { currentSnapshotId: snapshot?.id },
      });
    if (snapshot.applicationVersion !== app.version)
      throw new StaleVersionError(undefined, {
        details: { reason: 'application_changed_since_review' },
      });
    if (
      cmd.documentPackVersion !== this.pack.packVersion ||
      snapshot.documentPackVersion !== this.pack.packVersion
    )
      throw new StaleVersionError(undefined, {
        details: { currentDocumentPackVersion: this.pack.packVersion },
      });

    const existing = await this.signing.latestForSnapshot(snapshot.id);
    if (existing && OPEN_SIGNING_STATUSES.includes(existing.status)) {
      return {
        signingSessionId: existing.id,
        status: existing.status,
        providerRequestId: existing.providerRequestId,
        sdkLaunch: {},
      }; // no second chargeable request
    }
    if (existing?.status === 'EXECUTED')
      throw new ValidationError(undefined, {
        details: { reason: 'already_executed', signingSessionId: existing.id },
      });

    const [customer, identity] = await Promise.all([
      this.customers.findById(cmd.customerId),
      this.identities.latest(app.id),
    ]);
    const signerIdentifier =
      customer?.email ?? customer?.phone?.replace(/^\+/, '');
    if (!identity || !signerIdentifier)
      throw new ValidationError(undefined, {
        details: { reason: 'signer_unavailable' },
      });

    const now = this.clock.now();
    const sessionId = this.ids.prefixed(ID_PREFIX.signingSession);
    const { documents, packPdf, packSha256 } = await this.renderPack(
      snapshot,
      sessionId,
    );
    const packObjectKey = `applications/${app.id}/packs/${sessionId}/pack.pdf`;
    await this.storage.put(packObjectKey, packPdf, 'application/pdf');

    const created = await this.esign.createSignRequest({
      fileName: `pms-pack-${sessionId}.pdf`,
      file: packPdf,
      signer: {
        identifier: signerIdentifier,
        name: identity.legalName,
        reason: 'PMS agreement and account documents',
      },
      expireInDays: SIGNING_EXPIRE_DAYS,
      referenceId: app.id,
      customReference: sessionId,
    });
    await this.storage.put(
      `applications/${app.id}/packs/${sessionId}/sign-request.json`,
      JSON.stringify(created.raw),
      'application/json',
    );

    const session: SigningSession = {
      id: sessionId,
      applicationId: app.id,
      snapshotId: snapshot.id,
      documentPackVersion: snapshot.documentPackVersion,
      signingMethod: cmd.signingMethod,
      status: 'REQUESTED',
      providerRequestId: created.providerDocumentId,
      packObjectKey,
      packSha256,
      documents,
      pollCount: 0,
      lastProviderStatus: created.agreementStatus,
      createdAt: now,
      updatedAt: now,
    };
    await this.uow.run(async (tx) => {
      await this.signing.create(session, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'signing_session.created',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            signingSessionId: sessionId,
            snapshotId: snapshot.id,
            providerRequestId: created.providerDocumentId,
            packSha256,
            documents: documents.map((d) => ({
              type: d.documentType,
              sha256: d.sha256,
            })),
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'SigningSessionCreated',
          payload: { signingSessionId: sessionId },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Signing Request Created',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_SIGNING,
          outcome: 'requested',
        },
        tx,
      );
    });
    return {
      signingSessionId: sessionId,
      status: 'REQUESTED',
      providerRequestId: created.providerDocumentId,
      sdkLaunch: { accessToken: created.accessToken?.id },
    };
  }

  async get(
    applicationId: string,
    customerId: string,
    sessionId: string,
  ): Promise<SigningSessionView> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    const s = await this.signing.findById(sessionId);
    if (!s || s.applicationId !== applicationId) throw new NotFoundError();
    return {
      status: s.status,
      documentPackVersion: s.documentPackVersion,
      evidenceAvailable: !!s.evidenceKey,
      nextScreen: signingNextScreen(s.status),
    };
  }

  /** Every execution-required document, rendered from the snapshot and hashed individually, then merged into one pack. */
  private async renderPack(
    snapshot: ReviewSnapshot,
    sessionId: string,
  ): Promise<{
    documents: SigningDocument[];
    packPdf: Buffer;
    packSha256: string;
  }> {
    const data = {
      ...snapshot.sections,
      meta: {
        applicationVersion: snapshot.confirmedApplicationVersion,
        snapshotId: snapshot.id,
        documentPackVersion: snapshot.documentPackVersion,
      },
    } as unknown as Record<string, unknown>;
    const documents: SigningDocument[] = [];
    const pdfs: Buffer[] = [];
    for (const doc of this.pack.documents.filter((d) => d.executionRequired)) {
      const template = loadDocumentTemplate(doc.type, doc.version);
      const pdf = await this.renderer.render(
        renderTemplateText(template, data),
        `${doc.type} ${doc.version} | snapshot ${snapshot.id} | ${snapshot.hash.slice(0, 16)}`,
      );
      const sha256 = createHash('sha256').update(pdf).digest('hex');
      const objectKey = `applications/${snapshot.applicationId}/packs/${sessionId}/${doc.type.toLowerCase()}.pdf`;
      await this.storage.put(objectKey, pdf, 'application/pdf');
      documents.push({
        documentType: doc.type,
        documentVersion: doc.version,
        objectKey,
        sha256,
      });
      pdfs.push(pdf);
    }
    if (!pdfs.length)
      throw new ValidationError(undefined, {
        details: { reason: 'empty_document_pack' },
      });
    const packPdf = await this.renderer.merge(pdfs);
    return {
      documents,
      packPdf,
      packSha256: createHash('sha256').update(packPdf).digest('hex'),
    };
  }
}
