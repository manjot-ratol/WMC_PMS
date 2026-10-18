import { Inject, Injectable } from '@nestjs/common';
import { storageConfig } from '../../common/config/storage.config';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  assertDocumentShape,
  assertUploadRequest,
  type Document,
  type DocumentUpload,
} from '../../domain/documents/document';
import {
  DOCUMENT_REQUIREMENTS_RULEBOOK,
  type DocumentRequirementsRulebook,
} from '../../domain/documents/document-requirements-rulebook';
import { ID_PREFIX } from '../../domain/shared/public-id';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../ports/document.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface AuthoriseUploadCommand {
  applicationId: string;
  customerId: string;
  requirementId: string;
  contentType: string;
  sizeBytes: number;
}
export interface SubmitDocumentCommand {
  applicationId: string;
  customerId: string;
  requirementId: string;
  documentType: string;
  files: { uploadId: string; side: string }[];
}

export const SCREEN_DOCUMENTS = '10';

/** Screen 10: expiring upload authorisations, then server-side registration of uploaded files. */
@Injectable()
export class DocumentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(DOCUMENT_REQUIREMENTS_RULEBOOK)
    private readonly rulebook: DocumentRequirementsRulebook,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: Pick<
      ReturnType<typeof storageConfig>,
      'uploadUrlTtlSeconds'
    >,
  ) {}

  async authoriseUpload(cmd: AuthoriseUploadCommand): Promise<{
    uploadId: string;
    uploadUrl: string;
    expiresInSeconds: number;
  }> {
    await this.loadApplication(cmd.applicationId, cmd.customerId);
    if (!this.rulebook.requirements[cmd.requirementId])
      throw new ValidationError(undefined, {
        details: {
          field: 'requirement_id',
          allowed: Object.keys(this.rulebook.requirements),
        },
      });
    assertUploadRequest(cmd.contentType, cmd.sizeBytes, this.rulebook);
    const now = this.clock.now();
    const ttl = this.storageCfg.uploadUrlTtlSeconds;
    const upload: DocumentUpload = {
      id: this.ids.prefixed(ID_PREFIX.upload),
      applicationId: cmd.applicationId,
      requirementId: cmd.requirementId,
      objectKey: `applications/${cmd.applicationId}/uploads/${this.ids.uuid()}`,
      declaredContentType: cmd.contentType,
      declaredSizeBytes: cmd.sizeBytes,
      status: 'AUTHORISED',
      expiresAt: new Date(now.getTime() + ttl * 1000),
      createdAt: now,
    };
    await this.documents.createUpload(upload);
    const uploadUrl = await this.storage.presignPut(
      upload.objectKey,
      cmd.contentType,
      ttl,
    );
    return { uploadId: upload.id, uploadUrl, expiresInSeconds: ttl };
  }

  async submit(cmd: SubmitDocumentCommand): Promise<{
    documentId: string;
    status: 'PROCESSING';
    operationId: string;
  }> {
    await this.loadApplication(cmd.applicationId, cmd.customerId);
    assertDocumentShape(
      cmd.requirementId,
      cmd.documentType,
      cmd.files.map((f) => f.side),
      this.rulebook,
    );
    const now = this.clock.now();
    const uploads: DocumentUpload[] = [];
    for (const f of cmd.files) {
      const upload = await this.documents.findUpload(f.uploadId);
      if (
        !upload ||
        upload.applicationId !== cmd.applicationId ||
        upload.requirementId !== cmd.requirementId
      )
        throw new ValidationError(undefined, {
          details: {
            field: 'files',
            uploadId: f.uploadId,
            reason: 'unknown_upload',
          },
        });
      if (
        upload.status !== 'AUTHORISED' ||
        upload.expiresAt.getTime() < now.getTime()
      )
        throw new ValidationError(undefined, {
          details: {
            field: 'files',
            uploadId: f.uploadId,
            reason: 'upload_not_usable',
          },
        });
      if (!(await this.storage.head(upload.objectKey)))
        throw new ValidationError(undefined, {
          details: {
            field: 'files',
            uploadId: f.uploadId,
            reason: 'not_uploaded',
          },
        });
      uploads.push(upload);
    }
    const operationId = this.ids.prefixed(ID_PREFIX.operation);
    const doc: Document = {
      id: this.ids.prefixed(ID_PREFIX.document),
      applicationId: cmd.applicationId,
      requirementId: cmd.requirementId,
      documentType: cmd.documentType,
      files: cmd.files.map((f, i) => ({
        uploadId: f.uploadId,
        side: f.side,
        objectKey: uploads[i].objectKey,
      })),
      status: 'PROCESSING',
      operationId,
      createdAt: now,
      updatedAt: now,
    };
    await this.uow.run(async (tx) => {
      for (const u of uploads)
        await this.documents.updateUpload({ ...u, status: 'CONSUMED' }, tx);
      await this.documents.createDocument(doc, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'document.submitted',
          aggregateType: 'application',
          aggregateId: cmd.applicationId,
          details: {
            documentId: doc.id,
            requirementId: cmd.requirementId,
            documentType: cmd.documentType,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: cmd.applicationId,
          eventType: 'DocumentSubmitted',
          payload: { documentId: doc.id },
        },
        tx,
      );
    });
    return { documentId: doc.id, status: 'PROCESSING', operationId };
  }

  private async loadApplication(applicationId: string, customerId: string) {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    return app;
  }
}
