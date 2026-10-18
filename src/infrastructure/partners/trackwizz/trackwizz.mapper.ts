import type { As501Request } from '../../../application/ports/trackwizz-gateway.port';
import {
  splitName,
  toTrackWizzDate,
  type TrackWizzCodebook,
} from '../../../domain/compliance/as501';

/** Everything the AS501 customer record is built from; already verified upstream, never customer-typed free text. */
export interface As501Subject {
  customerId: string;
  applicationId: string;
  pan: string;
  legalName: string;
  dateOfBirth: string;
  email?: string;
  phone?: string;
  occupation?: string;
  annualIncomeBand?: string;
  pepDeclaration?: string;
  taxResidencyCountries?: string[];
  address?: {
    line1?: string;
    line2?: string;
    line3?: string;
    city?: string;
    stateCode?: string;
    pinCode?: string;
  };
  customerCreatedAt: Date;
}

/**
 * Maps verified data to the AS501 customer record with tenant codebooks. Unknown codebook keys are sent as empty
 * strings rather than guessed; the codebook is PLACEHOLDER_PENDING_COMPLIANCE.
 */
export function toAs501Request(
  requestId: string,
  purpose: string,
  s: As501Subject,
  cb: TrackWizzCodebook,
  sourceSystemName: string,
  now: Date,
): As501Request {
  const name = splitName(s.legalName);
  const today = toTrackWizzDate(now.toISOString().slice(0, 10));
  const countries = (s.taxResidencyCountries ?? [])
    .map((c) => cb.countries[c] ?? '')
    .filter(Boolean);
  const customer: Record<string, unknown> = {
    constitutionType: cb.constitutionType,
    sourceSystemName,
    sourceSystemCustomerCode: s.customerId,
    sourceSystemCustomerCreationDate: toTrackWizzDate(
      s.customerCreatedAt.toISOString().slice(0, 10),
    ),
    uniqueIdentifier: s.pan,
    applicationRefNumber: s.applicationId,
    segment: cb.segment,
    segmentStartDate: today,
    status: 'Active',
    effectiveDate: today,
    minor: '0',
    ekycOTPbased: '0',
    firstName: name.firstName,
    middleName: name.middleName,
    lastName: name.lastName,
    dateofBirth: toTrackWizzDate(s.dateOfBirth),
    pan: s.pan,
    personalEmail: s.email ?? '',
    personalMobileISD: s.phone ? '91' : '',
    personalMobileNumber: s.phone?.replace(/^\+91/, '') ?? '',
    occupationType: cb.occupationTypes[s.occupation ?? ''] ?? '',
    incomeRange: cb.incomeRanges[s.annualIncomeBand ?? ''] ?? '',
    politicallyExposed: cb.pep[s.pepDeclaration ?? ''] ?? '',
    countryOfResidence: cb.countries.IN,
    citizenships: cb.countries.IN,
    nationalities: cb.countries.IN,
    correspondenceAddressLine1: s.address?.line1 ?? '',
    correspondenceAddressLine2: s.address?.line2 ?? '',
    correspondenceAddressLine3: s.address?.line3 ?? '',
    correspondenceAddressCity: s.address?.city ?? '',
    correspondenceAddressState: s.address?.stateCode ?? '',
    correspondenceAddressZipCode: s.address?.pinCode ?? '',
    correspondenceAddressCountry: cb.countries.IN,
    taxDetailDtoList: countries.map((country) => ({ country })),
    screeningProfile: cb.screeningProfile,
    riskProfile: purpose === cb.riskPurpose ? cb.riskProfile : '',
    regAMLRiskSpecialCategoryDtoList: [],
    relatedPersonList: [],
    customerRelationDtoList: [],
  };
  return { requestId, sourceSystemName, purpose, customerList: [customer] };
}
