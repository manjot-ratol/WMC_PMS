import { createHash } from 'node:crypto';
import * as http from 'node:http';

export interface MfCentralMockOptions {
  port: number;
  /** Bind address; 127.0.0.1 for tests, 0.0.0.0 inside containers. */
  host?: string;
}
export interface MockCasRequest {
  reqId: string;
  clientRefNo: string;
  pan: string;
  mobile: string;
  email: string;
  redirectUrl: string;
  createdAt: string;
  outcome?: 'APPROVE' | 'DECLINE';
}
export interface CallbackFields {
  reqId: string;
  clientRefNo: string;
  status: 'SUCCESS' | 'FAILED';
  response?: string;
  errorMessage?: string;
}
export interface AuthoriseResult {
  redirectUrl: string;
  method: 'POST';
  fields: CallbackFields;
}

/** The mock's "encryption" is reversible base64url and its "signature" a SHA-256 tag: shape-compatible, not secure. */
export const mockEncrypt = (plain: string): string =>
  Buffer.from(plain, 'utf8').toString('base64url');
export const mockDecrypt = (cipher: string): string =>
  Buffer.from(cipher, 'base64url').toString('utf8');
export const mockSign = (encrypted: string): string =>
  `mock.${createHash('sha256').update(encrypted).digest('hex')}`;

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * In-process stand-in for MF Central's CAS API: OAuth token, the `/api/test/*` helpers, `newCasRequest`,
 * `validateQRCode`, the investor consent page and a programmatic authorise endpoint that returns exactly what
 * the consent page posts to the client's `redirectUrl`. PAN digits `9999` are rejected like an unwhitelisted
 * PAN on UAT (422 Invalid Input); digits `0000` yield an empty statement; anything else yields holdings.
 */
export class MfCentralMock {
  private server?: http.Server;
  private seq = 0;
  readonly requests = new Map<string, MockCasRequest>();
  readonly calls: { path: string; headers: http.IncomingHttpHeaders }[] = [];

  constructor(private readonly opts: MfCentralMockOptions) {}

  get baseUrl(): string {
    return `http://${this.opts.host ?? '127.0.0.1'}:${this.opts.port}`;
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          this.route(req, Buffer.concat(chunks).toString('utf8'), res);
        } catch (err) {
          json(res, 500, {
            errors: [
              {
                code: '500',
                message: err instanceof Error ? err.message : String(err),
              },
            ],
          });
        }
      });
    });
    return new Promise((resolve) =>
      this.server!.listen(this.opts.port, this.opts.host ?? '127.0.0.1', () =>
        resolve(),
      ),
    );
  }
  stop(): Promise<void> {
    return new Promise((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  /** What the consent page would post to `redirectUrl` for this request (by reqId or clientRefNo). */
  authorise(key: string, outcome: 'APPROVE' | 'DECLINE'): AuthoriseResult {
    const r =
      this.requests.get(key) ??
      [...this.requests.values()].find((x) => x.clientRefNo === key);
    if (!r) throw new Error('unknown request');
    r.outcome = outcome;
    const fields: CallbackFields =
      outcome === 'APPROVE'
        ? {
            reqId: r.reqId,
            clientRefNo: r.clientRefNo,
            status: 'SUCCESS',
            response: mockEncrypt(JSON.stringify(statementFor(r))),
          }
        : {
            reqId: r.reqId,
            clientRefNo: r.clientRefNo,
            status: 'FAILED',
            errorMessage: 'Investor declined consent',
          };
    return { redirectUrl: r.redirectUrl, method: 'POST', fields };
  }

  private route(
    req: http.IncomingMessage,
    body: string,
    res: http.ServerResponse,
  ): void {
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname;
    this.calls.push({ path, headers: req.headers });

    if (req.method === 'POST' && path === '/oauth/token') {
      if (!req.headers.authorization?.startsWith('Basic '))
        return json(res, 401, { error: 'unauthorized' });
      const form = new URLSearchParams(body);
      if (form.get('grant_type') !== 'password' || !form.get('username'))
        return json(res, 400, { error: 'invalid_grant' });
      this.seq += 1;
      return json(res, 200, {
        access_token: `mock-token-${this.seq}`,
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'read write trust',
      });
    }
    if (path.startsWith('/api/test/')) {
      if (!req.headers['key'] || !bearer(req))
        return json(res, 401, { error: 'unauthorized' });
      if (path === '/api/test/encrypt') return text(res, mockEncrypt(body));
      if (path === '/api/test/generateSignature')
        return text(res, mockSign(body));
      if (path === '/api/test/decrypt') {
        const plain = mockDecrypt(body.trim());
        if (!plain || mockEncrypt(plain) !== body.trim().replace(/=+$/, ''))
          return json(res, 400, {
            errors: [{ code: '400', message: 'Unable to decrypt' }],
          });
        return text(res, plain);
      }
    }
    if (req.method === 'POST' && path === '/api/client/V1/newCasRequest')
      return this.newCasRequest(req, body, res);
    if (req.method === 'POST' && path === '/api/client/V1/validateQRCode')
      return this.validateQr(req, body, res);
    if (req.method === 'GET' && path === '/investor')
      return this.consentPage(url, res);
    if (req.method === 'POST' && path === '/investor/decide') {
      const form = new URLSearchParams(body);
      return this.decide(
        form.get('reqId') ?? '',
        form.get('outcome') === 'APPROVE' ? 'APPROVE' : 'DECLINE',
        res,
      );
    }
    const m = /^\/mock\/requests\/([^/]+)\/authorise$/.exec(path);
    if (req.method === 'POST' && m) {
      const parsed = body ? (JSON.parse(body) as { outcome?: string }) : {};
      try {
        return json(
          res,
          200,
          this.authorise(
            decodeURIComponent(m[1]),
            parsed.outcome === 'DECLINE' ? 'DECLINE' : 'APPROVE',
          ),
        );
      } catch {
        return json(res, 404, {
          errors: [{ code: '404', message: 'unknown reqId' }],
        });
      }
    }
    if (req.method === 'GET' && path === '/mock/requests')
      return json(res, 200, [...this.requests.values()]);
    return json(res, 404, { errors: [{ code: '404', message: 'not found' }] });
  }

  private openEnvelope(
    req: http.IncomingMessage,
    body: string,
    res: http.ServerResponse,
  ): Record<string, string> | undefined {
    if (!req.headers['clientid'] || !bearer(req)) {
      json(res, 401, { error: 'unauthorized' });
      return undefined;
    }
    const env = JSON.parse(body) as { signature?: string; request?: string };
    if (!env.request || env.signature !== mockSign(env.request)) {
      json(res, 401, {
        response: mockEncrypt(
          JSON.stringify({
            reqId: '',
            errors: [{ code: '401', message: 'Invalid signature' }],
          }),
        ),
      });
      return undefined;
    }
    return JSON.parse(mockDecrypt(env.request)) as Record<string, string>;
  }

  private newCasRequest(
    req: http.IncomingMessage,
    body: string,
    res: http.ServerResponse,
  ): void {
    const r = this.openEnvelope(req, body, res);
    if (!r) return;
    const reqId = String(
      4_000_000_000 + Math.floor(Math.random() * 999_999_999),
    );
    const pan = (r.pan ?? '').toUpperCase();
    const invalid =
      !PAN.test(pan) ||
      pan.slice(5, 9) === '9999' ||
      !r.redirectUrl ||
      !r.clientRefNo ||
      !/^\+?\d{10,13}$/.test(r.mobile ?? '');
    if (invalid)
      return json(res, 422, {
        response: mockEncrypt(
          JSON.stringify({
            reqId,
            errors: [{ code: '422', message: 'Invalid Input' }],
          }),
        ),
      });
    this.requests.set(reqId, {
      reqId,
      clientRefNo: r.clientRefNo,
      pan,
      mobile: r.mobile,
      email: r.email ?? '',
      redirectUrl: r.redirectUrl,
      createdAt: new Date().toISOString(),
    });
    json(res, 200, {
      response: mockEncrypt(
        JSON.stringify({
          reqId,
          clientRefNo: r.clientRefNo,
          status: 'Success',
          message: 'CAS request registered; redirect the investor',
        }),
      ),
    });
  }

  private validateQr(
    req: http.IncomingMessage,
    body: string,
    res: http.ServerResponse,
  ): void {
    const r = this.openEnvelope(req, body, res);
    if (!r) return;
    const known = this.requests.get(r.reqId ?? '');
    if (!known || !r.qrCode)
      return json(res, 422, {
        response: mockEncrypt(
          JSON.stringify({
            reqId: r.reqId ?? '',
            errors: [{ code: '422', message: 'Invalid Input' }],
          }),
        ),
      });
    json(res, 200, {
      response: mockEncrypt(JSON.stringify(statementFor(known))),
    });
  }

  private consentPage(url: URL, res: http.ServerResponse): void {
    const reqId = url.searchParams.get('reqId') ?? '';
    const r = this.requests.get(reqId);
    if (!r)
      return html(
        res,
        404,
        page(
          'Unknown request',
          `<p>No CAS request <code>${esc(reqId)}</code>. Start again from the app.</p>`,
        ),
      );
    const maskedPan = `${r.pan.slice(0, 2)}••••••${r.pan.slice(-2)}`;
    const maskedMobile = `${r.mobile.slice(0, 3)}•••••${r.mobile.slice(-3)}`;
    html(
      res,
      200,
      page(
        'MF Central (mock) · consent',
        `<p>This is the <b>local stand-in</b> for MF Central's investor consent page. On UAT the investor enters an OTP here.</p>
<dl><dt>PAN</dt><dd>${maskedPan}</dd><dt>Mobile</dt><dd>${maskedMobile}</dd><dt>Request</dt><dd>${esc(r.reqId)}</dd><dt>Returns to</dt><dd>${esc(r.redirectUrl)}</dd></dl>
<form method="post" action="/investor/decide"><input type="hidden" name="reqId" value="${esc(r.reqId)}">
<button name="outcome" value="APPROVE" class="ok">Approve and share my statement</button>
<button name="outcome" value="DECLINE" class="no">Decline</button></form>`,
      ),
    );
  }

  private decide(
    reqId: string,
    outcome: 'APPROVE' | 'DECLINE',
    res: http.ServerResponse,
  ): void {
    let result: AuthoriseResult;
    try {
      result = this.authorise(reqId, outcome);
    } catch {
      return html(res, 404, page('Unknown request', '<p>Unknown request.</p>'));
    }
    const inputs = Object.entries(result.fields)
      .filter(([, v]) => v !== undefined)
      .map(
        ([k, v]) =>
          `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`,
      )
      .join('');
    html(
      res,
      200,
      page(
        'Returning to the application…',
        `<p>Sending the ${outcome === 'APPROVE' ? 'statement' : 'decline'} back to <code>${esc(result.redirectUrl)}</code>.</p>
<form id="f" method="post" action="${esc(result.redirectUrl)}">${inputs}<button>Continue</button></form>
<script>document.getElementById('f').submit();</script>`,
      ),
    );
  }
}

/** Deterministic holdings from the PAN digits so the same PAN always shows the same dashboard. */
export function statementFor(r: MockCasRequest): Record<string, unknown> {
  const digits = Number(r.pan.slice(5, 9));
  const asOf = new Date().toISOString().slice(0, 10);
  const base = { reqId: r.reqId, clientRefNo: r.clientRefNo, pan: r.pan };
  if (digits === 0)
    return {
      ...base,
      data: {
        asOf,
        investor: { name: 'MOCK INVESTOR', pan: r.pan },
        folios: [],
      },
    };
  const scale = 1 + (digits % 9);
  const scheme = (
    name: string,
    isin: string,
    type: string,
    units: number,
    nav: number,
    cost: number,
  ) => ({
    schemeName: name,
    isin,
    schemeType: type,
    units,
    nav,
    navDate: asOf,
    marketValue: Math.round(units * nav * 100) / 100,
    costValue: cost,
  });
  return {
    ...base,
    data: {
      asOf,
      investor: { name: 'MOCK INVESTOR', pan: r.pan },
      folios: [
        {
          amc: 'JioBlackRock Mutual Fund',
          folio: `${1000000 + digits}/45`,
          schemes: [
            scheme(
              'JioBlackRock Flexi Cap Fund - Direct Growth',
              'INF0JBR00011',
              'Equity',
              1200 * scale,
              18.42,
              18000 * scale,
            ),
            scheme(
              'JioBlackRock Liquid Fund - Direct Growth',
              'INF0JBR00029',
              'Debt',
              95.5 * scale,
              1052.1,
              100000 * scale,
            ),
          ],
        },
        {
          amc: 'Other Mutual Fund',
          folio: `${5000000 + digits}`,
          schemes: [
            scheme(
              'Other Balanced Advantage Fund - Direct Growth',
              'INF0OTH00037',
              'Hybrid',
              310 * scale,
              64.9,
              15000 * scale,
            ),
            scheme(
              'Other Nifty 50 Index Fund - Direct Growth',
              'INF0OTH00045',
              'Equity',
              800 * scale,
              27.35,
              20000 * scale,
            ),
          ],
        },
      ],
    },
  };
}

const bearer = (req: http.IncomingMessage): boolean =>
  /^Bearer mock-token-\d+$/.test(req.headers.authorization ?? '');
function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function text(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(body);
}
function html(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#1a1a1a}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px}dt{color:#666}button{font:inherit;padding:10px 16px;margin:8px 8px 0 0;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer}button.ok{background:#0b6e4f;color:#fff;border-color:#0b6e4f}button.no{color:#8a1c1c}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
