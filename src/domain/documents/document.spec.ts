import { ValidationError } from '../../common/errors/app-error';
import {
  assertDocumentShape,
  assertUploadRequest,
  sniffContentType,
} from './document';
import { loadDocumentRequirementsRulebook } from './document-requirements-rulebook';

describe('documents', () => {
  const rb = loadDocumentRequirementsRulebook();
  it('validates requirement, type and sides', () => {
    expect(() =>
      assertDocumentShape(
        'ADDRESS_PROOF',
        'PASSPORT',
        ['PHOTO_PAGE', 'ADDRESS_PAGE'],
        rb,
      ),
    ).not.toThrow();
    expect(() =>
      assertDocumentShape('ADDRESS_PROOF', 'PASSPORT', ['PHOTO_PAGE'], rb),
    ).toThrow(ValidationError);
    expect(() =>
      assertDocumentShape(
        'ADDRESS_PROOF',
        'PASSPORT',
        ['PHOTO_PAGE', 'ADDRESS_PAGE', 'BACK'],
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() => assertDocumentShape('NOPE', 'PASSPORT', [], rb)).toThrow(
      ValidationError,
    );
    expect(() => assertDocumentShape('ADDRESS_PROOF', 'NOPE', [], rb)).toThrow(
      ValidationError,
    );
  });
  it('validates upload content type and size', () => {
    expect(() => assertUploadRequest('image/jpeg', 100, rb)).not.toThrow();
    expect(() => assertUploadRequest('application/zip', 100, rb)).toThrow(
      ValidationError,
    );
    expect(() => assertUploadRequest('image/jpeg', 0, rb)).toThrow(
      ValidationError,
    );
    expect(() =>
      assertUploadRequest('image/jpeg', rb.maxSizeBytes + 1, rb),
    ).toThrow(ValidationError);
  });
  it('sniffs jpeg, png, pdf and rejects others', () => {
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      sniffContentType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('image/png');
    expect(sniffContentType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffContentType(Buffer.from('MZ\x90\x00'))).toBe('unknown');
    expect(sniffContentType(new Uint8Array([]))).toBe('unknown');
  });
});
