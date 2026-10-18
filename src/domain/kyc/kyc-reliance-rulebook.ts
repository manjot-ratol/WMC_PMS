import { loadRulebook } from '../shared/rulebook-loader';

export interface KycRelianceRulebook {
  version: string;
  effectiveFrom: string;
  reuseStatusSuffixes: string[];
  remediateStatusSuffixes: string[];
  freshStatusSuffixes: string[];
  noRecordErrorCodes: string[];
  maxRecordAgeDays: number;
  requireIpvFlagForReuse: boolean;
}
export const KYC_RELIANCE_RULEBOOK = Symbol('KYC_RELIANCE_RULEBOOK');
export const loadKycRelianceRulebook = (file?: string): KycRelianceRulebook =>
  loadRulebook<KycRelianceRulebook>(
    'kyc-reliance.v1.json',
    [
      'version',
      'reuseStatusSuffixes',
      'remediateStatusSuffixes',
      'freshStatusSuffixes',
      'noRecordErrorCodes',
    ],
    file,
  );
