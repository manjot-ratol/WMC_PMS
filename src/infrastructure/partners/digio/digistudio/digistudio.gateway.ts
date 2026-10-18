import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateKycRequestCommand,
  DigiStudioGatewayPort,
  KycRequestCreated,
  KycRequestStatus,
} from '../../../../application/ports/digistudio-gateway.port';
import { partnersConfig } from '../../../../common/config/partners.config';
import { PartnerRejectedError } from '../../../../common/errors/app-error';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { DigioGatewayBase, translateDigioError } from '../digio-gateway.base';
import {
  fromCreateResponse,
  fromStatusResponse,
  toTemplateRequest,
} from './digistudio.mapper';
import type { KycResponse } from './digistudio.types';

export const DIGISTUDIO_PATHS = {
  createWithTemplate: '/client/kyc/v2/request/with_template',
  status: (id: string) => `/client/kyc/v2/${encodeURIComponent(id)}/response`,
  media: (fileId: string) =>
    `/client/kyc/v2/media/${encodeURIComponent(fileId)}`,
  generateToken: '/user/auth/generate_token',
} as const;

/** Digio DigiStudio workflow requests. Docs: documentation.digio.in/digistudio/integration */
@Injectable()
export class DigiStudioGateway
  extends DigioGatewayBase
  implements DigiStudioGatewayPort
{
  constructor(
    http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    super(http, cfg.digio);
  }

  async createRequest(
    cmd: CreateKycRequestCommand,
  ): Promise<KycRequestCreated> {
    const res = await this.post<KycResponse>(
      'digistudio.createRequest',
      DIGISTUDIO_PATHS.createWithTemplate,
      toTemplateRequest(cmd),
      { referenceId: cmd.transactionId },
    );
    if (!res.data?.id)
      throw new PartnerRejectedError('digio', 'INVALID_RESPONSE', undefined, {
        details: { operation: 'digistudio.createRequest' },
      });
    return fromCreateResponse(res.data);
  }

  async getStatus(providerRequestId: string): Promise<KycRequestStatus> {
    const res = await this.post<KycResponse>(
      'digistudio.getStatus',
      DIGISTUDIO_PATHS.status(providerRequestId),
      {},
      { query: { detail_response: true }, referenceId: providerRequestId },
    );
    return fromStatusResponse(res.data, providerRequestId);
  }

  async regenerateAccessToken(
    providerRequestId: string,
  ): Promise<{ id: string; validTill?: string }> {
    const res = await this.post<{ id?: string; valid_till?: string }>(
      'digistudio.regenerateToken',
      DIGISTUDIO_PATHS.generateToken,
      { entityId: providerRequestId },
      { referenceId: providerRequestId },
    );
    if (!res.data?.id)
      throw new PartnerRejectedError('digio', 'INVALID_RESPONSE', undefined, {
        details: { operation: 'digistudio.regenerateToken' },
      });
    return { id: res.data.id, validTill: res.data.valid_till };
  }

  async downloadMedia(
    fileId: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    try {
      const res = await this.http.request<Buffer>({
        partner: 'digio',
        operation: 'digistudio.downloadMedia',
        method: 'GET',
        url: `${this.config.baseUrl}${DIGISTUDIO_PATHS.media(fileId)}`,
        responseType: 'arraybuffer',
        auth: {
          type: 'basic',
          username: this.config.clientId,
          password: this.config.clientSecret,
        },
        timeoutMs: this.config.timeoutMs,
      });
      return {
        data: res.data,
        contentType: res.headers['content-type'] ?? 'application/octet-stream',
      };
    } catch (err) {
      throw translateDigioError(err, 'digistudio.downloadMedia');
    }
  }
}
