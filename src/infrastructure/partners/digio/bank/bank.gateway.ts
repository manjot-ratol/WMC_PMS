import { Inject, Injectable } from '@nestjs/common';
import type {
  BankGatewayPort,
  BankVerifyCommand,
  BankVerifyResult,
} from '../../../../application/ports/bank-gateway.port';
import { partnersConfig } from '../../../../common/config/partners.config';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { DigioGatewayBase } from '../digio-gateway.base';

export const BANK_PATHS = { verify: '/v4/client/verify/bank_account' } as const;

/** Vendor wire types (documentation.digio.in/digikyc/bank_account_verification). */
interface FundsTransferAccountVerificationRequest {
  beneficiary_account_no: string;
  beneficiary_ifsc: string;
  beneficiary_name?: string;
  validation_mode: 'AUTO' | 'PENNY_DROP' | 'PENNY_LESS';
  unique_request_id: string;
}
interface ExternalAccountVerificationResponseV4 {
  id?: string;
  verified?: boolean;
  verified_at?: string;
  beneficiary_name_with_bank?: string;
  fuzzy_match_result?: boolean;
  fuzzy_match_score?: number;
  error_code?: string;
  error_msg?: string;
  validation_mode?: string;
}

export function toVerifyRequest(
  cmd: BankVerifyCommand,
): FundsTransferAccountVerificationRequest {
  return {
    beneficiary_account_no: cmd.accountNumber,
    beneficiary_ifsc: cmd.ifsc,
    beneficiary_name: cmd.beneficiaryName,
    validation_mode: cmd.validationMode,
    unique_request_id: cmd.uniqueRequestId,
  };
}
export function fromVerifyResponse(
  r: ExternalAccountVerificationResponseV4,
): BankVerifyResult {
  return {
    providerReference: r.id,
    verified: r.verified === true,
    beneficiaryNameWithBank: r.beneficiary_name_with_bank,
    fuzzyMatchScore:
      typeof r.fuzzy_match_score === 'number' ? r.fuzzy_match_score : undefined,
    fuzzyMatchResult: r.fuzzy_match_result,
    errorCode: r.error_code,
    errorMessage: r.error_msg,
    validationMode: r.validation_mode,
    raw: r,
  };
}

@Injectable()
export class DigioBankGateway
  extends DigioGatewayBase
  implements BankGatewayPort
{
  constructor(
    http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    super(http, cfg.digio);
  }

  async verify(cmd: BankVerifyCommand): Promise<BankVerifyResult> {
    const res = await this.post<ExternalAccountVerificationResponseV4>(
      'bank.verify',
      BANK_PATHS.verify,
      toVerifyRequest(cmd),
      { referenceId: cmd.uniqueRequestId },
    );
    return fromVerifyResponse(res.data ?? {});
  }
}
