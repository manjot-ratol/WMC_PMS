import { ValidationError } from '../../common/errors/app-error';
import type { DocumentRequirementsRulebook } from './document-requirements-rulebook';

export type UploadStatus = 'AUTHORISED' | 'CONSUMED' | 'EXPIRED';
export type DocumentStatus = 'PROCESSING' | 'VERIFIED' | 'REJECTED';

export interface DocumentUpload {
  readonly id: string;
  readonly applicationId: string;
  readonly requirementId: string;
  readonly objectKey: string;
  readonly declaredContentType: string;
  readonly declaredSizeBytes: number;
  readonly status: UploadStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface DocumentFile {
  uploadId: string;
  side: string;
  objectKey: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface Document {
  readonly id: string;
  readonly applicationId: string;
  readonly requirementId: string;
  readonly documentType: string;
  readonly files: DocumentFile[];
  readonly status: DocumentStatus;
  readonly operationId: string;
  readonly safeErrorCategory?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Validates the requirement / document type / sides combination against the catalogue. */
export function assertDocumentShape(
  requirementId: string,
  documentType: string,
  sides: string[],
  rulebook: DocumentRequirementsRulebook,
): void {
  const req = rulebook.requirements[requirementId];
  if (!req)
    throw new ValidationError(undefined, {
      details: {
        field: 'requirement_id',
        allowed: Object.keys(rulebook.requirements),
      },
    });
  const expected = req.documentTypes[documentType];
  if (!expected)
    throw new ValidationError(undefined, {
      details: {
        field: 'document_type',
        allowed: Object.keys(req.documentTypes),
      },
    });
  const missing = expected.filter((s) => !sides.includes(s));
  const unknown = sides.filter((s) => !expected.includes(s));
  if (missing.length || unknown.length)
    throw new ValidationError(undefined, {
      details: { field: 'files', missingSides: missing, unknownSides: unknown },
    });
}

export function assertUploadRequest(
  contentType: string,
  sizeBytes: number,
  rulebook: DocumentRequirementsRulebook,
): void {
  if (!rulebook.allowedContentTypes.includes(contentType))
    throw new ValidationError(undefined, {
      details: { field: 'content_type', allowed: rulebook.allowedContentTypes },
    });
  if (
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > rulebook.maxSizeBytes
  )
    throw new ValidationError(undefined, {
      details: { field: 'size_bytes', max: rulebook.maxSizeBytes },
    });
}

/** Sniffs the real content type from leading bytes; anything else is unsafe for this product. */
export function sniffContentType(
  bytes: Uint8Array,
): 'image/jpeg' | 'image/png' | 'application/pdf' | 'unknown' {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image/png';
  if (
    bytes.length >= 5 &&
    Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-'
  )
    return 'application/pdf';
  return 'unknown';
}
