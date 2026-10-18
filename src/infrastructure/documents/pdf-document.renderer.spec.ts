import { PDFDocument } from 'pdf-lib';
import { PdfDocumentRenderer, wrap } from './pdf-document.renderer';

describe('PdfDocumentRenderer', () => {
  const r = new PdfDocumentRenderer();
  it('renders deterministic PDFs with the content and merges packs', async () => {
    const doc = {
      title: 'Disclosure Document',
      sections: [
        {
          heading: 'Client',
          paragraphs: ['PAN: AB••••••4F — name Vinod', 'word '.repeat(300)],
        },
      ],
    };
    const a = await r.render(doc, 'snapshot snap_1 | sha');
    const b = await r.render(doc, 'snapshot snap_1 | sha');
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.equals(b)).toBe(true);
    const loaded = await PDFDocument.load(a);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(loaded.getTitle()).toBe('Disclosure Document');
    const merged = await r.merge([
      a,
      await r.render({ title: 'MITC', sections: [] }, 'f'),
    ]);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(
      loaded.getPageCount() + 1,
    );
  });
  it('pages overflow onto new pages and wraps long words', async () => {
    const many = {
      title: 'T',
      sections: Array.from({ length: 40 }, (_, i) => ({
        heading: `H${i}`,
        paragraphs: ['lorem ipsum '.repeat(40)],
      })),
    };
    expect(
      (await PDFDocument.load(await r.render(many, 'f'))).getPageCount(),
    ).toBeGreaterThan(2);
    expect(wrap('aaa bbb ccc', (t) => t.length * 10, 75)).toEqual([
      'aaa bbb',
      'ccc',
    ]);
    expect(wrap('', () => 0, 10)).toEqual(['']);
    expect(wrap('superlongword', (t) => t.length * 10, 10)).toEqual([
      'superlongword',
    ]);
  });
});
