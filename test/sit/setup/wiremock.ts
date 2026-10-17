/** Minimal WireMock admin client for SIT: reset, stub, and inspect recorded requests. */
const ADMIN = process.env.WIREMOCK_URL ?? 'http://localhost:8080';

async function admin(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${ADMIN}/__admin${path}`, init);
  if (!res.ok) throw new Error(`WireMock ${path} -> ${res.status}`);
  return res;
}

export const wiremock = {
  baseUrl: ADMIN,
  /** Removes runtime stubs and request journal; file-based mappings in tools/wiremock stay. */
  async reset(): Promise<void> {
    await admin('/requests', { method: 'DELETE' });
    await admin('/mappings/reset', { method: 'POST' });
  },
  async stubFor(mapping: Record<string, unknown>): Promise<void> {
    await admin('/mappings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mapping),
    });
  },
  async requestsTo(
    urlPath: string,
    method = 'POST',
  ): Promise<{ headers: Record<string, string>; body: string }[]> {
    const res = await admin('/requests/find', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, urlPath }),
    });
    const data = (await res.json()) as {
      requests: { headers: Record<string, string>; body: string }[];
    };
    return data.requests;
  },
  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${ADMIN}/__admin/health`);
      return res.ok;
    } catch {
      return false;
    }
  },
};
