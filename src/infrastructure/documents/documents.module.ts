import { Global, Module } from '@nestjs/common';
import { DOCUMENT_RENDERER } from '../../application/ports/document-renderer.port';
import { PdfDocumentRenderer } from './pdf-document.renderer';

@Global()
@Module({
  providers: [
    PdfDocumentRenderer,
    { provide: DOCUMENT_RENDERER, useExisting: PdfDocumentRenderer },
  ],
  exports: [DOCUMENT_RENDERER, PdfDocumentRenderer],
})
export class DocumentsModule {}
