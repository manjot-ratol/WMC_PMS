import {
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { loadRulebook } from '../shared/rulebook-loader';

export interface PackDocument {
  type: string;
  version: string;
  acknowledgementRequired: boolean;
  executionRequired: boolean;
}
export interface DocumentPackRulebook {
  version: string;
  packVersion: number;
  documents: PackDocument[];
  feeUnderstandingNote: { minLength: number; maxLength: number };
}
export const DOCUMENT_PACK_RULEBOOK = Symbol('DOCUMENT_PACK_RULEBOOK');
export const loadDocumentPackRulebook = (file?: string): DocumentPackRulebook =>
  loadRulebook<DocumentPackRulebook>(
    'document-pack.v1.json',
    ['version', 'packVersion', 'documents', 'feeUnderstandingNote'],
    file,
  );

export interface AcknowledgementItemInput {
  documentType: string;
  documentVersion: string;
  acknowledged: boolean;
}
export interface AcknowledgementsInput {
  documentPackVersion: number;
  acknowledgements: AcknowledgementItemInput[];
  feeUnderstandingNote: string;
}
export interface Acknowledgement {
  readonly applicationId: string;
  readonly version: number;
  readonly documentPackVersion: number;
  readonly items: { documentType: string; documentVersion: string }[];
  readonly feeUnderstandingNote: string;
  readonly feeAnnexureExecutionRequired: boolean;
  readonly recordedAt: Date;
}

/**
 * Every acknowledgement-required document must be explicitly acknowledged at its current version; an old pack
 * version is stale (409). Viewing is never acknowledgement, and the note is the customer's own words.
 */
export function validateAcknowledgements(
  input: AcknowledgementsInput,
  rulebook: DocumentPackRulebook,
): {
  feeAnnexureExecutionRequired: boolean;
  items: { documentType: string; documentVersion: string }[];
  note: string;
} {
  if (input.documentPackVersion !== rulebook.packVersion)
    throw new StaleVersionError(undefined, {
      details: { currentDocumentPackVersion: rulebook.packVersion },
    });
  const items: { documentType: string; documentVersion: string }[] = [];
  for (const doc of rulebook.documents.filter(
    (d) => d.acknowledgementRequired,
  )) {
    const given = input.acknowledgements.filter(
      (a) => a.documentType === doc.type,
    );
    if (given.length !== 1)
      throw new ValidationError(undefined, {
        details: {
          field: 'acknowledgements',
          reason: given.length
            ? 'duplicate_document'
            : 'missing_acknowledgement',
          documentType: doc.type,
        },
      });
    const [a] = given;
    if (a.documentVersion !== doc.version)
      throw new StaleVersionError(undefined, {
        details: {
          documentType: doc.type,
          currentDocumentVersion: doc.version,
        },
      });
    if (a.acknowledged !== true)
      throw new ValidationError(undefined, {
        details: {
          field: 'acknowledgements',
          reason: 'not_acknowledged',
          documentType: doc.type,
        },
      });
    items.push({ documentType: doc.type, documentVersion: doc.version });
  }
  const known = new Set(rulebook.documents.map((d) => d.type));
  const unknown = input.acknowledgements.find(
    (a) => !known.has(a.documentType),
  );
  if (unknown)
    throw new ValidationError(undefined, {
      details: {
        field: 'acknowledgements',
        reason: 'unknown_document',
        documentType: unknown.documentType,
      },
    });
  const note = (input.feeUnderstandingNote ?? '').trim().replace(/\s+/g, ' ');
  const { minLength, maxLength } = rulebook.feeUnderstandingNote;
  if (note.length < minLength || note.length > maxLength)
    throw new ValidationError(
      'Describe in your own words how the fees apply to you.',
      { details: { field: 'fee_understanding_note', minLength, maxLength } },
    );
  return {
    feeAnnexureExecutionRequired: rulebook.documents.some(
      (d) => d.type === 'FEE_ANNEXURE' && d.executionRequired,
    ),
    items,
    note,
  };
}
