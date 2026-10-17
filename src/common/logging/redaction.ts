export const REDACTED = '[REDACTED]';

/** Keys whose values must never reach logs. Matched case-insensitively at any depth. */
export const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'otp',
  'pan',
  'pan_no',
  'aadhaar',
  'uid_no',
  'account_number',
  'tin',
  'password',
  'authorization',
  'access_token',
  'token',
  'secret',
  'client_secret',
]);

const KEY_VALUE_IN_STRING = new RegExp(
  `\\b(${[...REDACTED_KEYS].map((k) => k.replace(/_/g, '[_-]?')).join('|')})(\\s*[=:]\\s*)([^\\s,;]+)`,
  'gi',
);

function redactString(s: string): string {
  return s.replace(
    KEY_VALUE_IN_STRING,
    (_m, k: string, sep: string) => `${k}${sep}${REDACTED}`,
  );
}

/** Deep-copies `value`, replacing sensitive keys and key=value fragments. Handles arrays, Errors and cycles. */
export function redact(
  value: unknown,
  keys: ReadonlySet<string> = REDACTED_KEYS,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, keys, seen));

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack,
    };
    for (const [k, v] of Object.entries(value))
      out[k] = redactValue(k, v, keys, seen);
    if ('cause' in value && value.cause !== undefined)
      out.cause = redact(value.cause, keys, seen);
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    out[k] = redactValue(k, v, keys, seen);
  return out;
}

function redactValue(
  key: string,
  v: unknown,
  keys: ReadonlySet<string>,
  seen: WeakSet<object>,
): unknown {
  return keys.has(key.toLowerCase()) ? REDACTED : redact(v, keys, seen);
}
