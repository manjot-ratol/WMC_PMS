/** Extracts a bearer token from an Authorization header value, or undefined. */
export function bearerToken(
  header: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,512})$/.exec(value ?? '');
  return m ? m[1] : undefined;
}
