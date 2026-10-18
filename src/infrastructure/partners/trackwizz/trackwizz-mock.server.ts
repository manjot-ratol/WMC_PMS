import * as http from 'node:http';
import type { As501Response } from '../../../domain/compliance/as501';
import {
  TrackWizzEnvelope,
  type TrackWizzCryptoProfile,
} from './trackwizz-envelope';

export type Scenario =
  | 'NO_HITS'
  | 'PROBABLE_HIT'
  | 'CONFIRMED_HIT'
  | 'RISK_LOW'
  | 'RISK_HIGH'
  | 'REJECT'
  | 'BAD_SIGNATURE';
export interface MockOptions {
  port: number;
  /** Bind address; 127.0.0.1 for tests, 0.0.0.0 inside containers. */
  host?: string;
  /** The mock plays TrackWizz: it signs with TrackWizz's private key and decrypts with it. */
  theirPrivateKeyPem: string;
  /** Our public key, used by the mock to wrap the session key for us and to verify our signature. */
  ourPublicKeyPem: string;
  profile?: TrackWizzCryptoProfile;
}
interface DecryptedRequest {
  requestId: string;
  purpose: string;
  customerList: { sourceSystemCustomerCode?: string }[];
}

/** In-process AS501 stand-in that performs the real crypto path so SIT exercises seal/open end to end. */
export class TrackWizzMock {
  private server?: http.Server;
  private readonly envelope: TrackWizzEnvelope;
  readonly requests: {
    purpose: string;
    requestId: string;
    headers: http.IncomingHttpHeaders;
  }[] = [];
  private scenario: Scenario = 'NO_HITS';
  private riskScenario: Scenario = 'RISK_LOW';

  constructor(private readonly opts: MockOptions) {
    this.envelope = new TrackWizzEnvelope(
      opts.theirPrivateKeyPem,
      opts.ourPublicKeyPem,
      opts.profile,
    );
  }

  /** Screening scenarios (01/03) and risk scenarios (06) are set independently. */
  setScenario(s: Scenario): void {
    if (s === 'RISK_LOW' || s === 'RISK_HIGH') this.riskScenario = s;
    else this.scenario = s;
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          if (
            req.method !== 'POST' ||
            !req.url?.endsWith('/CustomerInfo/as501')
          )
            return reply(res, 404, { message: 'not found' });
          if (
            !req.headers['apitoken'] ||
            !req.headers['cluster'] ||
            !req.headers['domain']
          )
            return reply(res, 401, { message: 'MRV1 API Token is mandatory' });
          const incoming = JSON.parse(
            Buffer.concat(chunks).toString('utf8'),
          ) as Record<string, string>;
          const request = this.envelope.open<DecryptedRequest>(incoming);
          this.requests.push({
            purpose: request.purpose,
            requestId: request.requestId,
            headers: req.headers,
          });
          const body = this.build(request);
          const sealed = this.envelope.seal(body);
          if (
            (request.purpose === '06' ? this.riskScenario : this.scenario) ===
            'BAD_SIGNATURE'
          )
            sealed.Signature = Buffer.from('tampered').toString('base64');
          reply(res, 200, sealed);
        } catch (err) {
          reply(res, 400, {
            message: `MRV6 ${err instanceof Error ? err.message : String(err)}`,
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

  private build(request: DecryptedRequest): As501Response {
    const code = request.customerList[0]?.sourceSystemCustomerCode ?? '';
    const purposes = request.purpose.split(',');
    const scenario = purposes.includes('06')
      ? this.riskScenario
      : this.scenario;
    if (scenario === 'REJECT')
      return {
        RequestId: request.requestId,
        ValidationCode: 'MRV14',
        ValidationDescription: 'ConstitutionType is mandatory',
        DecryptedData: { OverallStatus: 'RejectedByTW', CustomerResponse: [] },
      };
    const purposeResponse = purposes.map((p) => {
      if (p === '04')
        return {
          Purpose: 'Continuous Screening',
          PurposeCode: '04',
          ValidationCode: '',
          ValidationDescription: '',
          ValidationFailureCount: 0,
          Data: null,
        };
      if (p === '06')
        return {
          Purpose: 'Risk Rating',
          PurposeCode: '06',
          ValidationCode: '',
          ValidationDescription: '',
          ValidationFailureCount: 0,
          Data: {
            RiskValue: scenario === 'RISK_HIGH' ? 'High' : 'Low',
            NextRiskReviewDate: '21-Mar-2027',
            ReportData: Buffer.from('report').toString('base64'),
          },
        };
      const data =
        scenario === 'CONFIRMED_HIT'
          ? {
              SuggestedAction: 'Stop',
              HitsDetected: 'Yes',
              HitsCount: 2,
              ConfirmedHits: 'Yes',
              CaseId: `CASE${request.requestId.slice(-6)}`,
              CaseURL: 'https://tenant-sb.trackwizz.com/case/1',
              ReportData: Buffer.from('report').toString('base64'),
              HitResponse: [
                {
                  Source: 'FBI Wanted Person',
                  WatchlistSourceId: '20',
                  MatchType: 'KeyActivity',
                  Score: 100,
                },
                {
                  Source: 'Sanctions',
                  WatchlistSourceId: '7',
                  MatchType: 'Probable',
                  Score: 65,
                },
              ],
            }
          : scenario === 'PROBABLE_HIT'
            ? {
                SuggestedAction: 'Review',
                HitsDetected: 'Yes',
                HitsCount: 1,
                ConfirmedHits: 'No',
                CaseId: `CASE${request.requestId.slice(-6)}`,
                CaseURL: 'https://tenant-sb.trackwizz.com/case/2',
                ReportData: Buffer.from('report').toString('base64'),
                HitResponse: [
                  {
                    Source: 'PEP list',
                    WatchlistSourceId: '3',
                    MatchType: 'Probable',
                    Score: 70,
                  },
                ],
              }
            : {
                SuggestedAction: 'Proceed',
                HitsDetected: 'No',
                HitsCount: 0,
                ConfirmedHits: 'No',
                ReportData: '',
              };
      return {
        Purpose: 'Initial Screening with API Response and No Storage',
        PurposeCode: p,
        ValidationCode: '',
        ValidationDescription: '',
        ValidationFailureCount: 0,
        Data: data,
      };
    });
    return {
      RequestId: request.requestId,
      ValidationCode: null,
      ValidationDescription: null,
      DecryptedData: {
        OverallStatus: 'AcceptedByTW',
        CustomerResponse: [
          {
            SourceSystemCustomerCode: code,
            ValidationOutcome: 'Success',
            PurposeResponse: purposeResponse,
          },
        ],
      },
    };
  }
}

function reply(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
