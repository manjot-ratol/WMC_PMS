import type { Provider } from '@nestjs/common';
import {
  DOCUMENT_REQUIREMENTS_RULEBOOK,
  loadDocumentRequirementsRulebook,
} from '../domain/documents/document-requirements-rulebook';
import {
  ELIGIBILITY_RULEBOOK,
  loadEligibilityRulebook,
} from '../domain/eligibility/eligibility-rulebook';
import { IPV_RULEBOOK, loadIpvRulebook } from '../domain/ipv/ipv-rulebook';
import {
  KYC_RELIANCE_RULEBOOK,
  loadKycRelianceRulebook,
} from '../domain/kyc/kyc-reliance-rulebook';
import { BANK_RULEBOOK, loadBankRulebook } from '../domain/bank/bank-account';
import {
  NOMINATION_RULEBOOK,
  loadNominationRulebook,
} from '../domain/nomination/nomination';
import { TAX_RULEBOOK, loadTaxRulebook } from '../domain/profile/declarations';
import {
  PROFILE_RULEBOOK,
  loadProfileRulebook,
} from '../domain/profile/profile';
import {
  DOCUMENT_PACK_RULEBOOK,
  loadDocumentPackRulebook,
} from '../domain/documents/document-pack';
import { FEE_RULEBOOK, loadFeeRulebook } from '../domain/fees/fee-engine';
import {
  SUITABILITY_RULEBOOK,
  loadSuitabilityRulebook,
} from '../domain/suitability/suitability';
import {
  ACCOUNT_OPENING_RULEBOOK,
  loadAccountOpeningRulebook,
} from '../domain/account-opening/account-opening';
import {
  ACTIVATION_RULEBOOK,
  loadActivationRulebook,
} from '../domain/activation/activation';
import {
  FUNDING_RULEBOOK,
  loadFundingRulebook,
} from '../domain/funding/funding';
import {
  TRACKWIZZ_CODEBOOK,
  loadTrackWizzCodebook,
} from '../domain/compliance/as501';

/** Versioned configuration loaded once per process. */
export const KycRelianceRulebookProviders: Provider[] = [
  {
    provide: ELIGIBILITY_RULEBOOK,
    useFactory: () => loadEligibilityRulebook(),
  },
  {
    provide: KYC_RELIANCE_RULEBOOK,
    useFactory: () => loadKycRelianceRulebook(),
  },
  {
    provide: DOCUMENT_REQUIREMENTS_RULEBOOK,
    useFactory: () => loadDocumentRequirementsRulebook(),
  },
  { provide: IPV_RULEBOOK, useFactory: () => loadIpvRulebook() },
  { provide: PROFILE_RULEBOOK, useFactory: () => loadProfileRulebook() },
  { provide: TAX_RULEBOOK, useFactory: () => loadTaxRulebook() },
  { provide: BANK_RULEBOOK, useFactory: () => loadBankRulebook() },
  { provide: NOMINATION_RULEBOOK, useFactory: () => loadNominationRulebook() },
  {
    provide: SUITABILITY_RULEBOOK,
    useFactory: () => loadSuitabilityRulebook(),
  },
  { provide: FEE_RULEBOOK, useFactory: () => loadFeeRulebook() },
  {
    provide: DOCUMENT_PACK_RULEBOOK,
    useFactory: () => loadDocumentPackRulebook(),
  },
  {
    provide: ACCOUNT_OPENING_RULEBOOK,
    useFactory: () => loadAccountOpeningRulebook(),
  },
  { provide: FUNDING_RULEBOOK, useFactory: () => loadFundingRulebook() },
  { provide: ACTIVATION_RULEBOOK, useFactory: () => loadActivationRulebook() },
  { provide: TRACKWIZZ_CODEBOOK, useFactory: () => loadTrackWizzCodebook() },
];
