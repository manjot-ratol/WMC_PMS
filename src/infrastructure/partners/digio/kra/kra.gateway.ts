import { Inject, Injectable } from '@nestjs/common';
import type {
  KraDocumentQuery,
  KraGatewayPort,
  KraPanQuery,
  KraRecord,
  KraRegistrationCommand,
  KraRegistrationResult,
  KraStatusResult,
} from '../../../../application/ports/kra-gateway.port';
import { partnersConfig } from '../../../../common/config/partners.config';
import {
  PartnerRejectedError,
  ValidationError,
} from '../../../../common/errors/app-error';
import { HttpClientService } from '../../../../common/http/http-client.service';
import type { IsoDate } from '../../../../domain/shared/iso-date';
import { DigioGatewayBase } from '../digio-gateway.base';
import {
  fromFetchResponse,
  fromRegisterResponse,
  fromStatusResponse,
  toDocumentRequest,
  toPanRequest,
  toRegisterRequest,
} from './kra.mapper';
import type {
  KraCheckPanStatusResponse,
  KraFetchDetailsResponse,
  KraUploadDetailsResponse,
} from './kra.types';

export const KRA_PATHS = {
  checkPanStatus: '/v3/client/kyc/kra/v2/get_pan_status',
  fetchDetails: '/v3/client/kyc/kra/download_pan',
  register: '/v3/client/kyc/kra/app/register',
  downloadDocuments: '/v3/client/kyc/kra/download_document',
} as const;

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Digio DigiKYC KRA gateway. Docs: https://documentation.digio.in/digikyc/kra/api_integration/ */
@Injectable()
export class DigioKraGateway
  extends DigioGatewayBase
  implements KraGatewayPort
{
  constructor(
    http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    super(http, cfg.digio);
  }

  async checkPanStatus(query: KraPanQuery): Promise<KraStatusResult> {
    assertPan(query.pan);
    const res = await this.post<KraCheckPanStatusResponse>(
      'kra.checkPanStatus',
      KRA_PATHS.checkPanStatus,
      toPanRequest(query),
      {
        referenceId: query.uniqueRequestId,
      },
    );
    return fromStatusResponse(res.data);
  }

  async fetchDetails(
    query: KraPanQuery & { dob: IsoDate },
    opts: { deserializeCodes?: boolean } = {},
  ): Promise<KraRecord> {
    assertPan(query.pan);
    if (!query.dob)
      throw new ValidationError(
        'Date of birth or incorporation is required to fetch KRA details',
        { details: { field: 'dob' } },
      );
    const res = await this.post<KraFetchDetailsResponse>(
      'kra.fetchDetails',
      KRA_PATHS.fetchDetails,
      toPanRequest(query),
      {
        referenceId: query.uniqueRequestId,
        query:
          opts.deserializeCodes === undefined
            ? undefined
            : { deserialize_codes: opts.deserializeCodes },
      },
    );
    return fromFetchResponse(res.data);
  }

  async register(
    command: KraRegistrationCommand,
  ): Promise<KraRegistrationResult> {
    const res = await this.post<KraUploadDetailsResponse>(
      'kra.register',
      KRA_PATHS.register,
      toRegisterRequest(command),
      {
        referenceId: command.uniqueRequestId,
      },
    );
    return fromRegisterResponse(res.data);
  }

  async downloadDocuments(query: KraDocumentQuery): Promise<Buffer> {
    assertPan(query.pan);
    if (!query.dob && !query.refNo)
      throw new ValidationError(
        'Either dob or refNo is required to download KRA documents',
        { details: { field: 'dob|refNo' } },
      );
    const res = await this.post<Buffer>(
      'kra.downloadDocuments',
      KRA_PATHS.downloadDocuments,
      toDocumentRequest(query),
      { responseType: 'arraybuffer' },
    );
    const contentType = res.headers['content-type'] ?? '';
    if (
      !contentType.includes('application/octet-stream') &&
      !contentType.includes('application/zip')
    ) {
      throw new PartnerRejectedError(
        'digio',
        'UNEXPECTED_CONTENT_TYPE',
        undefined,
        { details: { operation: 'kra.downloadDocuments', contentType } },
      );
    }
    return res.data;
  }
}

function assertPan(pan: string): void {
  if (!PAN_RE.test((pan ?? '').trim().toUpperCase())) {
    throw new ValidationError('PAN must be in the format ABCDE1234F', {
      details: { field: 'pan' },
    });
  }
}
