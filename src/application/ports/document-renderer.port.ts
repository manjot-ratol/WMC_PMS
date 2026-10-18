export interface RenderedText {
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
}
export interface DocumentRendererPort {
  /** Renders one document to PDF bytes. */
  render(doc: RenderedText, footer: string): Promise<Buffer>;
  /** Concatenates PDFs in order into one pack. */
  merge(pdfs: Buffer[]): Promise<Buffer>;
}
export const DOCUMENT_RENDERER = Symbol('DOCUMENT_RENDERER');
