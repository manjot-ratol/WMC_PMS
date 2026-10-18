import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

/** Approved receiving arrangement for client funds. Configuration only; never derived from customer input. */
export const fundingConfig = registerAs('funding', () => ({
  beneficiaryName: env().FUNDING_BENEFICIARY_NAME,
  beneficiaryAccountNumber: env().FUNDING_BENEFICIARY_ACCOUNT_NUMBER,
  beneficiaryIfsc: env().FUNDING_BENEFICIARY_IFSC,
  beneficiaryBankName: env().FUNDING_BENEFICIARY_BANK_NAME,
}));
export type FundingConfig = ReturnType<typeof fundingConfig>;
