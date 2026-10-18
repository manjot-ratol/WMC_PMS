import { ValidationError } from '../../common/errors/app-error';

export type EmailAddress = string & { readonly __brand: 'EmailAddress' };

// Pragmatic RFC 5322 subset: one @, non-empty local part, dotted domain with a 2+ letter TLD.
const LABEL = '[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?';
const EMAIL_RE = new RegExp(
  `^[^\\s@]{1,64}@${LABEL}(\\.${LABEL})*\\.[A-Za-z]{2,}$`,
);

/** Trims and lower-cases the domain; the local part is kept as entered (no destructive rewriting). */
export function normaliseEmail(raw: unknown): EmailAddress {
  if (typeof raw !== 'string')
    throw new ValidationError('Enter a valid email address', {
      details: { field: 'email' },
    });
  const trimmed = raw.trim();
  if (trimmed.length > 254 || !EMAIL_RE.test(trimmed))
    throw new ValidationError('Enter a valid email address', {
      details: { field: 'email' },
    });
  const at = trimmed.lastIndexOf('@');
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}` as EmailAddress;
}

export function maskEmail(email: EmailAddress): string {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  return `${local.slice(0, 1)}***@${email.slice(at + 1)}`;
}
