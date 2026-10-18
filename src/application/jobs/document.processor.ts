import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import {
  sniffContentType,
  type Document,
  type DocumentFile,
} from '../../domain/documents/document';
import {
  DOCUMENT_REQUIREMENTS_RULEBOOK,
  type DocumentRequirementsRulebook,
} from '../../domain/documents/document-requirements-rulebook';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../ports/document.repository.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import { SCREEN_DOCUMENTS } from '../documents/document.service';

export interface DocumentJobPayload {
  payload: { documentId: string };
}

/** Screen 10 follow-up: verifies the real content type, size and checksum of each uploaded file. */
@Processor(QUEUES.DOCUMENTS)
export class DocumentProcessor extends BaseProcessor<DocumentJobPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(DOCUMENT_REQUIREMENTS_RULEBOOK)
    private readonly rulebook: DocumentRequirementsRulebook,
  ) {
    super(store);
    this.logger = logger.child('DocumentProcessor');
  }

  async handle(data: DocumentJobPayload): Promise<void> {
    const doc = await this.documents.findDocument(data.payload.documentId);
    if (!doc || doc.status !== 'PROCESSING') return;
    const files: DocumentFile[] = [];
    let rejection: string | undefined;
    for (const file of doc.files) {
      const info = await this.storage.head(file.objectKey);
      if (!info) {
        rejection = 'missing_object';
        files.push(file);
        continue;
      }
      if (info.sizeBytes > this.rulebook.maxSizeBytes) {
        rejection = rejection ?? 'too_large';
        files.push({ ...file, sizeBytes: info.sizeBytes });
        continue;
      }
      const bytes = await this.storage.get(file.objectKey);
      const sniffed = sniffContentType(bytes);
      const upload = await this.documents.findUpload(file.uploadId);
      if (
        sniffed === 'unknown' ||
        !this.rulebook.allowedContentTypes.includes(sniffed) ||
        (upload && upload.declaredContentType !== sniffed)
      )
        rejection = rejection ?? 'content_type_mismatch';
      files.push({
        ...file,
        sizeBytes: bytes.length,
        contentType: sniffed === 'unknown' ? undefined : sniffed,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const updated: Document = {
      ...doc,
      files,
      status: rejection ? 'REJECTED' : 'VERIFIED',
      safeErrorCategory: rejection,
      updatedAt: this.clock.now(),
    };
    await this.uow.run(async (tx) => {
      await this.documents.updateDocument(updated, tx);
      await this.audit.append(
        {
          actorType: 'SYSTEM',
          action: 'document.processed',
          aggregateType: 'application',
          aggregateId: doc.applicationId,
          details: {
            documentId: doc.id,
            status: updated.status,
            category: rejection,
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Document Processing Completed',
          applicationId: doc.applicationId,
          screenId: SCREEN_DOCUMENTS,
          outcome: updated.status.toLowerCase(),
          safeErrorCategory: rejection,
        },
        tx,
      );
    });
    if (rejection)
      this.logger.info('document.rejected', {
        documentId: doc.id,
        category: rejection,
      });
  }
}
