import { ValidationError } from '../../common/errors/app-error';
import { loadRulebook } from '../shared/rulebook-loader';

export interface TaxRulebook {
  version: string;
  homeCountry: string;
  tinUnavailableReasons: string[];
  pepDeclarations: string[];
  maxResidencies: number;
}
export const TAX_RULEBOOK = Symbol('TAX_RULEBOOK');
export const loadTaxRulebook = (file?: string): TaxRulebook =>
  loadRulebook<TaxRulebook>(
    'tax.v1.json',
    ['version', 'homeCountry', 'tinUnavailableReasons', 'pepDeclarations'],
    file,
  );

export interface TaxResidencyInput {
  country: string;
  tin?: string | null;
  tinUnavailableReason?: string | null;
}
export interface DeclarationsInput {
  taxResidencies: TaxResidencyInput[];
  pepDeclaration: string;
  declarationVersion: string;
}
export interface Declarations extends DeclarationsInput {
  readonly applicationId: string;
  readonly version: number;
  readonly additionalInformationRequired: boolean;
  readonly attestedAt: Date;
}

const ISO2 = /^[A-Z]{2}$/;

/**
 * Validates residencies and the PEP answer. For the home country the TIN must be the verified PAN.
 * Returns whether FATCA/CRS follow-up is required (any foreign residency).
 */
export function validateDeclarations(
  input: DeclarationsInput,
  verifiedPan: string,
  isResident: boolean,
  rulebook: TaxRulebook,
): { additionalInformationRequired: boolean } {
  const residencies = input.taxResidencies ?? [];
  if (!residencies.length || residencies.length > rulebook.maxResidencies)
    throw new ValidationError(undefined, {
      details: {
        field: 'tax_residencies',
        min: 1,
        max: rulebook.maxResidencies,
      },
    });
  if (!rulebook.pepDeclarations.includes(input.pepDeclaration))
    throw new ValidationError(undefined, {
      details: { field: 'pep_declaration', allowed: rulebook.pepDeclarations },
    });
  if (!input.declarationVersion)
    throw new ValidationError(undefined, {
      details: { field: 'declaration_version' },
    });
  const seen = new Set<string>();
  for (const r of residencies) {
    const country = (r.country ?? '').toUpperCase();
    if (!ISO2.test(country))
      throw new ValidationError(undefined, {
        details: { field: 'tax_residencies.country', value: r.country },
      });
    if (seen.has(country))
      throw new ValidationError(undefined, {
        details: { field: 'tax_residencies.country', reason: 'duplicate' },
      });
    seen.add(country);
    const tin = (r.tin ?? '').replace(/\s+/g, '').toUpperCase();
    if (country === rulebook.homeCountry) {
      if (tin !== verifiedPan)
        throw new ValidationError(
          'The Indian tax identifier must match the verified PAN',
          { details: { field: 'tax_residencies.tin', country } },
        );
    } else if (
      !tin &&
      !rulebook.tinUnavailableReasons.includes(r.tinUnavailableReason ?? '')
    ) {
      throw new ValidationError(undefined, {
        details: {
          field: 'tax_residencies.tin',
          country,
          allowedReasons: rulebook.tinUnavailableReasons,
        },
      });
    }
  }
  if (isResident && !seen.has(rulebook.homeCountry))
    throw new ValidationError(undefined, {
      details: { field: 'tax_residencies', reason: 'home_country_required' },
    });
  const additionalInformationRequired = [...seen].some(
    (c) => c !== rulebook.homeCountry,
  );
  return { additionalInformationRequired };
}
