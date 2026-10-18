import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateSignRequestCommand,
  EsignGatewayPort,
  SignDocumentStatus,
  SignRequestCreated,
} from '../../../../application/ports/esign-gateway.port';
import { partnersConfig } from '../../../../common/config/partners.config';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { DigioGatewayBase, translateDigioError } from '../digio-gateway.base';

export const ESIGN_PATHS = {
  upload: '/v2/client/document/uploadpdf',
  document: (id: string) => `/v2/client/document/${encodeURIComponent(id)}`,
  download: '/v2/client/document/download',
  cancel: (id: string) =>
    `/v2/client/document/${encodeURIComponent(id)}/cancel`,
} as const;

/** Vendor wire types (documentation.digio.in/digisign; extracts under docs/partners/digio/esign). */
interface UploadPdfRequest {
  file_name: string;
  file_data: string;
  signers: {
    identifier: string;
    name: string;
    reason: string;
    sign_type: string;
  }[];
  expire_in_days: number;
  display_on_page: 'first' | 'last' | 'all' | 'custom';
  notify_signers: boolean;
  send_sign_link: boolean;
  generate_access_token: boolean;
  reference_id: string;
  custom_reference: string;
}
interface DocumentResponse {
  id?: string;
  agreement_status?: string;
  signing_parties?: { identifier?: string; name?: string; status?: string }[];
  access_token?: { id?: string; validTill?: string };
}

export function toUploadRequest(
  cmd: CreateSignRequestCommand,
  signType: string,
): UploadPdfRequest {
  return {
    file_name: cmd.fileName,
    file_data: cmd.file.toString('base64'),
    signers: [
      {
        identifier: cmd.signer.identifier,
        name: cmd.signer.name,
        reason: cmd.signer.reason,
        sign_type: signType,
      },
    ],
    expire_in_days: cmd.expireInDays,
    display_on_page: 'all',
    notify_signers: false,
    send_sign_link: false,
    generate_access_token: true,
    reference_id: cmd.referenceId,
    custom_reference: cmd.customReference,
  };
}
export function fromDocumentResponse(r: DocumentResponse): SignDocumentStatus {
  return {
    providerDocumentId: r.id ?? '',
    agreementStatus: r.agreement_status ?? '',
    signers: (r.signing_parties ?? []).map((p) => ({
      identifier: p.identifier,
      name: p.name,
      status: p.status,
    })),
    raw: r,
  };
}

@Injectable()
export class DigioEsignGateway
  extends DigioGatewayBase
  implements EsignGatewayPort
{
  constructor(
    http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    super(http, cfg.digio);
  }

  async createSignRequest(
    cmd: CreateSignRequestCommand,
  ): Promise<SignRequestCreated> {
    const res = await this.post<DocumentResponse>(
      'esign.createSignRequest',
      ESIGN_PATHS.upload,
      toUploadRequest(cmd, this.config.esign.signType),
      { referenceId: cmd.customReference },
    );
    const r = res.data;
    if (!r.id) throw new Error('Digio eSign response has no document id');
    return {
      providerDocumentId: r.id,
      agreementStatus: r.agreement_status ?? '',
      accessToken: r.access_token?.id
        ? { id: r.access_token.id, validTill: r.access_token.validTill }
        : undefined,
      raw: r,
    };
  }

  async getDocument(providerDocumentId: string): Promise<SignDocumentStatus> {
    try {
      const res = await this.http.request<DocumentResponse>({
        partner: 'digio',
        operation: 'esign.getDocument',
        method: 'GET',
        url: `${this.config.baseUrl}${ESIGN_PATHS.document(providerDocumentId)}`,
        responseType: 'json',
        auth: this.auth(),
        timeoutMs: this.config.timeoutMs,
      });
      return fromDocumentResponse(res.data);
    } catch (err) {
      throw translateDigioError(err, 'esign.getDocument');
    }
  }

  async downloadSigned(providerDocumentId: string): Promise<Buffer> {
    try {
      const res = await this.http.request<Buffer>({
        partner: 'digio',
        operation: 'esign.download',
        method: 'GET',
        url: `${this.config.baseUrl}${ESIGN_PATHS.download}`,
        query: { document_id: providerDocumentId },
        responseType: 'arraybuffer',
        auth: this.auth(),
        timeoutMs: this.config.timeoutMs,
      });
      return res.data;
    } catch (err) {
      throw translateDigioError(err, 'esign.download');
    }
  }

  async cancel(providerDocumentId: string, reason: string): Promise<void> {
    await this.post('esign.cancel', ESIGN_PATHS.cancel(providerDocumentId), {
      cancel_reason: reason,
    });
  }

  private auth() {
    return {
      type: 'basic' as const,
      username: this.config.clientId,
      password: this.config.clientSecret,
    };
  }
}
