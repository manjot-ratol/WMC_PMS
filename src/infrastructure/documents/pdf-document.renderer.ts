import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type {
  DocumentRendererPort,
  RenderedText,
} from '../../application/ports/document-renderer.port';

const PAGE = { width: 595.28, height: 841.89, margin: 56 } as const; // A4, points
const SIZES = { title: 18, heading: 12, body: 10.5, footer: 8 } as const;

/** Plain, deterministic PDF rendering with pdf-lib; layout is content-only (no branding) pending the approved templates. */
@Injectable()
export class PdfDocumentRenderer implements DocumentRendererPort {
  async render(doc: RenderedText, footer: string): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(doc.title);
    pdf.setProducer('wmc-pms');
    pdf.setCreationDate(new Date(0));
    pdf.setModificationDate(new Date(0));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const maxWidth = PAGE.width - 2 * PAGE.margin;
    let page = pdf.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - PAGE.margin;
    const newPage = () => {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    };
    const line = (text: string, size: number, f = font) => {
      if (y < PAGE.margin + size) newPage();
      page.drawText(sanitise(text), {
        x: PAGE.margin,
        y,
        size,
        font: f,
        color: rgb(0, 0, 0),
      });
      y -= size * 1.45;
    };
    const paragraph = (text: string, size: number, f = font) => {
      for (const l of wrap(
        sanitise(text),
        (t) => f.widthOfTextAtSize(t, size),
        maxWidth,
      ))
        line(l, size, f);
      y -= size * 0.6;
    };
    line(doc.title, SIZES.title, bold);
    y -= 8;
    for (const s of doc.sections) {
      line(s.heading, SIZES.heading, bold);
      for (const p of s.paragraphs) paragraph(p, SIZES.body);
    }
    for (const p of pdf.getPages())
      p.drawText(sanitise(footer), {
        x: PAGE.margin,
        y: PAGE.margin / 2,
        size: SIZES.footer,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    return Buffer.from(await pdf.save({ useObjectStreams: false }));
  }

  async merge(pdfs: Buffer[]): Promise<Buffer> {
    const out = await PDFDocument.create();
    out.setProducer('wmc-pms');
    out.setCreationDate(new Date(0));
    out.setModificationDate(new Date(0));
    for (const bytes of pdfs) {
      const src = await PDFDocument.load(bytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    }
    return Buffer.from(await out.save({ useObjectStreams: false }));
  }
}

/** Helvetica (WinAnsi) cannot encode every code point; swap the ones we use and drop the rest. */
function sanitise(text: string): string {
  return text
    .replace(/•/g, '*')
    .replace(/[—–]/g, '-')
    .replace(new RegExp('[^\x20-\x7E\u00A0-\u00FF]', 'g'), '?');
}

export function wrap(
  text: string,
  widthOf: (t: string) => number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (widthOf(candidate) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
