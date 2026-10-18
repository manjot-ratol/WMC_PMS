import { Inject, Injectable } from '@nestjs/common';
import type {
  CasRequest,
  CasRequestResult,
  MfCentralCryptoPort,
  MfCentralGatewayPort,
  ValidateQrRequest,
} from '../../../application/ports/mfcentral-gateway.port';
import { partnersConfig } from '../../../common/config/partners.config';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../../common/errors/app-error';
import { HttpClientService } from '../../../common/http/http-client.service';
import type { HttpRequestSpec } from '../../../common/http/http-request.types';
import { PartnerHttpError } from '../../../common/http/partner-http.error';
import { MfCentralLocalCrypto } from './mfcentral-local.crypto';

export const MFC_PATHS = {
  token: '/oauth/token',
  encrypt: '/api/test/encrypt',
  sign: '/api/test/generateSignature',
  decrypt: '/api/test/decrypt',
  newCas: '/api/client/V1/newCasRequest',
  validateQr: '/api/client/V1/validateQRCode',
} as const;
export type MfCentralConfig = ReturnType<typeof partnersConfig>['mfcentral'];

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}
interface EnvelopeResponse {
  signature?: string;
  request?: string;
  response?: string;
  data?: string;
  [k: string]: unknown;
}

/** Exactly the collection's flow: token → encrypt → sign → call → decrypt. Secrets only from configuration. */
@Injectable()
export class MfCentralGateway implements MfCentralGatewayPort {
  private readonly cfg: MfCentralConfig;
  private token?: { value: string; expiresAt: number };
  private readonly crypto: MfCentralCryptoPort;

  constructor(
    private readonly http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    this.cfg = cfg.mfcentral;
    this.crypto =
      this.cfg.cryptoMode === 'local'
        ? new MfCentralLocalCrypto(this.cfg.encryptionKey, this.cfg.privateJwk)
        : new RemoteHelperCrypto(this);
  }

  async newCasRequest(req: CasRequest): Promise<CasRequestResult> {
    return this.signedCall('newCasRequest', MFC_PATHS.newCas, {
      clientRefNo: req.clientRefNo,
      reqId: req.reqId ?? '',
      pan: req.pan,
      pekrn: req.pekrn ?? '',
      email: req.email ?? '',
      mobile: req.mobile ?? '',
      fromDate: req.fromDate ?? '',
      toDate: req.toDate ?? '',
      redirectUrl: req.redirectUrl,
    });
  }
  async validateQrCode(req: ValidateQrRequest): Promise<CasRequestResult> {
    return this.signedCall('validateQRCode', MFC_PATHS.validateQr, {
      clientRefNo: req.clientRefNo,
      reqId: req.reqId,
      qrCode: req.qrCode,
    });
  }
  buildRedirectUrl(reqId: string, clientRefNo: string): string {
    const u = new URL(this.cfg.appUrl);
    u.searchParams.set('reqId', reqId);
    u.searchParams.set('clientRefNo', clientRefNo);
    return u.toString();
  }

  /** OAuth2 password grant (collection: username/password/grant_type form) with HTTP Basic client credentials. */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000)
      return this.token.value;
    const res = await this.call<TokenResponse>('token', {
      method: 'POST',
      url: `${this.cfg.baseUrl}${MFC_PATHS.token}`,
      body: {
        username: this.cfg.username,
        password: this.cfg.password,
        grant_type: 'password',
      },
      bodyType: 'form',
      auth: {
        type: 'basic',
        username: this.cfg.clientId,
        password: this.cfg.clientSecret,
      },
    });
    if (!res.data.access_token)
      throw new PartnerRejectedError('mfcentral', 'no_access_token');
    this.token = {
      value: res.data.access_token,
      expiresAt: Date.now() + (res.data.expires_in ?? 300) * 1000,
    };
    return this.token.value;
  }

  /** The collection's `/api/test/*` helpers (headers ClientId, bearer token, `key`). */
  async helper(
    path: string,
    keyKind: 'EncryptionDecryptionKey' | 'PrivateKey',
    body: string,
  ): Promise<string> {
    const token = await this.accessToken();
    const res = await this.call<string>(`helper.${path.split('/').pop()}`, {
      method: 'POST',
      url: `${this.cfg.baseUrl}${path}`,
      body,
      bodyType: 'text',
      responseType: 'text',
      headers: {
        ClientId: this.cfg.clientId,
        Authorization: `Bearer ${token}`,
        key:
          keyKind === 'PrivateKey'
            ? this.cfg.privateJwk
            : this.cfg.encryptionKey,
      },
    });
    return String(res.data).trim();
  }

  private async signedCall(
    operation: string,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<CasRequestResult> {
    const token = await this.accessToken();
    const encrypted = await this.crypto.encrypt(JSON.stringify(payload));
    const signature = await this.crypto.sign(encrypted);
    let res: { data: EnvelopeResponse };
    try {
      res = await this.call<EnvelopeResponse>(operation, {
        method: 'POST',
        url: `${this.cfg.baseUrl}${path}`,
        body: { signature, request: encrypted },
        headers: {
          ClientId: this.cfg.clientId,
          Authorization: `Bearer ${token}`,
          Origin: this.cfg.appUrl,
        },
      });
    } catch (err) {
      // Validation rejections come back encrypted too ({reqId, errors:[{code,message}]}); surface them for operators.
      if (err instanceof PartnerRejectedError) {
        const cipher = (err.cause as { body?: EnvelopeResponse } | undefined)
          ?.body?.response;
        if (typeof cipher === 'string') {
          const decoded = await this.tryDecrypt(cipher);
          if (decoded) {
            throw new PartnerRejectedError(
              'mfcentral',
              firstErrorCode(decoded),
              undefined,
              {
                cause: err,
                details: {
                  ...(err.details as Record<string, unknown>),
                  operation,
                  reqId: str(decoded.reqId),
                  vendorErrors: decoded.errors,
                },
              },
            );
          }
        }
      }
      throw err;
    }
    const cipher = res.data.response ?? res.data.data ?? res.data.request;
    const decrypted =
      typeof cipher === 'string'
        ? (JSON.parse(await this.crypto.decrypt(cipher)) as Record<
            string,
            unknown
          >)
        : (res.data as Record<string, unknown>);
    return {
      reqId: str(decrypted.reqId),
      clientRefNo: str(decrypted.clientRefNo),
      status: str(decrypted.status),
      raw: decrypted,
    };
  }

  private async tryDecrypt(
    cipher: string,
  ): Promise<
    | { reqId?: unknown; errors?: { code?: string; message?: string }[] }
    | undefined
  > {
    try {
      return JSON.parse(await this.crypto.decrypt(cipher)) as {
        reqId?: unknown;
        errors?: { code?: string; message?: string }[];
      };
    } catch {
      return undefined;
    }
  }

  private async call<T>(
    operation: string,
    spec: Omit<HttpRequestSpec, 'partner' | 'operation' | 'timeoutMs'>,
  ): Promise<{ data: T }> {
    try {
      return await this.http.request<T>({
        partner: 'mfcentral',
        operation: `mfcentral.${operation}`,
        responseType: 'json',
        timeoutMs: this.cfg.timeoutMs,
        ...spec,
      });
    } catch (err) {
      if (!(err instanceof PartnerHttpError)) throw err;
      if (err.isTransport || (err.status !== undefined && err.status >= 500))
        throw new DependencyUnavailableError(undefined, {
          cause: err,
          details: { partner: 'mfcentral', operation, status: err.status },
        });
      throw new PartnerRejectedError('mfcentral', err.vendorCode, undefined, {
        cause: err,
        details: { operation, status: err.status },
      });
    }
  }
}

/** Default crypto: MF Central's own helper endpoints, exactly as the UAT collection does it. */
class RemoteHelperCrypto implements MfCentralCryptoPort {
  constructor(private readonly gw: MfCentralGateway) {}
  encrypt(plainJson: string): Promise<string> {
    return this.gw.helper(
      MFC_PATHS.encrypt,
      'EncryptionDecryptionKey',
      plainJson,
    );
  }
  sign(encrypted: string): Promise<string> {
    return this.gw.helper(MFC_PATHS.sign, 'PrivateKey', encrypted);
  }
  decrypt(encrypted: string): Promise<string> {
    return this.gw.helper(
      MFC_PATHS.decrypt,
      'EncryptionDecryptionKey',
      encrypted,
    );
  }
}
const str = (v: unknown): string | undefined =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
const firstErrorCode = (d: {
  errors?: { code?: string }[];
}): string | undefined => d.errors?.[0]?.code;
