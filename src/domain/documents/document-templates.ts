import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DocumentTemplate {
  type: string;
  version: string;
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
}

/** Templates live beside the rulebooks: `config/document-templates/<type>.<version>.json`. */
export function loadDocumentTemplate(
  type: string,
  version: string,
  dir?: string,
): DocumentTemplate {
  const file = path.resolve(
    dir ?? path.resolve(process.cwd(), 'config', 'document-templates'),
    `${type.toLowerCase()}.${version}.json`,
  );
  const t = JSON.parse(fs.readFileSync(file, 'utf8')) as DocumentTemplate;
  if (t.type !== type || t.version !== version)
    throw new Error(`Template ${file} declares ${t.type}/${t.version}`);
  return t;
}

/** Replaces `{{a.b.c}}` with the value at that path in `data`; arrays join with ", "; missing paths become "—". */
export function fillPlaceholders(
  text: string,
  data: Record<string, unknown>,
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, p: string) => {
    const v = p
      .split('.')
      .reduce<unknown>(
        (o, k) =>
          o && typeof o === 'object'
            ? (o as Record<string, unknown>)[k]
            : undefined,
        data,
      );
    if (v === undefined || v === null || v === '') return '—';
    if (Array.isArray(v)) return v.map(stringify).join(', ');
    return stringify(v);
  });
}

export function renderTemplateText(
  template: DocumentTemplate,
  data: Record<string, unknown>,
): { title: string; sections: { heading: string; paragraphs: string[] }[] } {
  return {
    title: template.title,
    sections: template.sections.map((s) => ({
      heading: s.heading,
      paragraphs: s.paragraphs.map((p) => fillPlaceholders(p, data)),
    })),
  };
}

function stringify(v: unknown): string {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return typeof v === 'string' ? v : String(v);
}
