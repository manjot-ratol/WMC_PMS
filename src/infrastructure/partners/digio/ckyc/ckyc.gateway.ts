import { Inject, Injectable } from '@nestjs/common';
import type {
  CkycGatewayPort,
  CkycRegisterCommand,
  CkycRegisterResult,
} from '../../../../application/ports/ckyc-gateway.port';
import { partnersConfig } from '../../../../common/config/partners.config';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { DigioGatewayBase } from '../digio-gateway.base';

export const CKYC_PATHS = { register: '/v3/client/kyc/ckyc/register' } as const;

interface CkycRegisterResponse {
  id?: string;
  request_id?: string;
  status?: string;
  ckyc_no?: string;
}

/**
 * Digio CKYC upload (spec appendix "CKYC: Upload / update"): multipart/form-data with the `register_ckyc_request`
 * JSON part plus the matching file parts. Never a plain JSON body.
 */
@Injectable()
export class DigioCkycGateway
  extends DigioGatewayBase
  implements CkycGatewayPort
{
  constructor(
    http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    super(http, cfg.digio);
  }

  async register(cmd: CkycRegisterCommand): Promise<CkycRegisterResult> {
    const form = new FormData();
    form.append('register_ckyc_request', JSON.stringify(cmd.registration));
    for (const f of cmd.files)
      form.append(
        f.field,
        new Blob([new Uint8Array(f.data)], { type: f.contentType }),
        f.fileName,
      );
    const res = await this.post<CkycRegisterResponse>(
      'ckyc.register',
      CKYC_PATHS.register,
      form,
      { bodyType: 'multipart', referenceId: cmd.uniqueRequestId },
    );
    const r = res.data;
    return {
      providerRequestId: r.request_id ?? r.id,
      status: r.status,
      ckycNumber: r.ckyc_no,
      raw: r,
    };
  }
}
