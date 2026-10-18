import type { Document, DocumentUpload } from '../../domain/documents/document';
import type { TransactionContext } from './unit-of-work.port';

export interface DocumentRepositoryPort {
  createUpload(upload: DocumentUpload, tx?: TransactionContext): Promise<void>;
  findUpload(
    id: string,
    tx?: TransactionContext,
  ): Promise<DocumentUpload | null>;
  updateUpload(upload: DocumentUpload, tx?: TransactionContext): Promise<void>;
  createDocument(doc: Document, tx?: TransactionContext): Promise<void>;
  findDocument(id: string, tx?: TransactionContext): Promise<Document | null>;
  updateDocument(doc: Document, tx?: TransactionContext): Promise<void>;
  latestVerified(
    applicationId: string,
    requirementId: string,
    tx?: TransactionContext,
  ): Promise<Document | null>;
}
export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');
