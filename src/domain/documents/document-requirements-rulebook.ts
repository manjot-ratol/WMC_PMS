import { loadRulebook } from '../shared/rulebook-loader';

export interface DocumentRequirementsRulebook {
  version: string;
  maxSizeBytes: number;
  allowedContentTypes: string[];
  requirements: Record<string, { documentTypes: Record<string, string[]> }>;
}
export const DOCUMENT_REQUIREMENTS_RULEBOOK = Symbol(
  'DOCUMENT_REQUIREMENTS_RULEBOOK',
);
export const loadDocumentRequirementsRulebook = (
  file?: string,
): DocumentRequirementsRulebook =>
  loadRulebook<DocumentRequirementsRulebook>(
    'document-requirements.v1.json',
    ['version', 'maxSizeBytes', 'allowedContentTypes', 'requirements'],
    file,
  );
