export interface BankVerifyCommand {
  accountNumber: string;
  ifsc: string;
  /** Verified legal name used for the provider's fuzzy match. */
  beneficiaryName: string;
  validationMode: 'AUTO' | 'PENNY_DROP' | 'PENNY_LESS';
  uniqueRequestId: string;
}
export interface BankVerifyResult {
  providerReference?: string;
  verified: boolean;
  beneficiaryNameWithBank?: string;
  fuzzyMatchScore?: number;
  fuzzyMatchResult?: boolean;
  errorCode?: string;
  errorMessage?: string;
  validationMode?: string;
  raw: unknown;
}
export interface BankGatewayPort {
  verify(cmd: BankVerifyCommand): Promise<BankVerifyResult>;
}
export const BANK_GATEWAY = Symbol('BANK_GATEWAY');
