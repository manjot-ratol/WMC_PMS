import type { IsoDate } from '../../domain/shared/iso-date';

export type KraServiceProvider = 'NDML' | 'CDSL' | 'CAMS';
export type KraFetchType = 'I' | 'E';

export interface KraPanQuery {
  pan: string;
  dob?: IsoDate;
  fetchType?: KraFetchType;
  serviceProvider?: KraServiceProvider;
  /** Unique per call; sent to Digio as unique_request_id and X_REFERENCE_ID. */
  uniqueRequestId: string;
}

export interface KraStatusResult {
  pan?: string;
  name?: string;
  /** 3-digit code; first digit identifies the KRA holding the record. Never mapped to a decision here. */
  statusCode?: string;
  status?: string;
  statusDescription?: string;
  kraStatusCode?: string;
  statusDate?: IsoDate;
  entryDate?: IsoDate;
  modificationDate?: IsoDate;
  updateStatus?: string;
  kycMode?: string;
  ipvFlag?: string;
  refId?: string;
  /** Untouched vendor body, retained as evidence. */
  raw: unknown;
}

export interface KraAddress {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  pinCode?: string;
  proofCode?: string;
  proofDate?: IsoDate;
}

export interface KraRecord {
  pan?: string;
  name?: string;
  dob?: IsoDate;
  gender?: string;
  fatherName?: string;
  nationalityCode?: string;
  residentialStatus?: string;
  applicationType?: string;
  mobile?: string;
  email?: string;
  correspondenceAddress?: KraAddress;
  permanentAddress?: KraAddress;
  incomeCode?: string;
  occupationCode?: string;
  politicalConnection?: string;
  kyc: {
    status?: string;
    statusCode?: string;
    statusDescription?: string;
    statusDate?: IsoDate;
    ipvFlag?: string;
    ipvDate?: IsoDate;
    kycMode?: string;
    /** kyc_information.internal_reference; use as ref_no for document download. */
    internalReference?: string;
  };
  kraInfo?: { kra?: string; requestDate?: IsoDate; responseDate?: string };
  error?: { code?: string; description?: string; additional?: string };
  refId?: string;
  raw: unknown;
}

export interface KraRegistrationCommand {
  uniqueRequestId: string;
  apiRequestType?: 'stateless' | 'workflow' | 'stateless_async';
  serviceProvider?: KraServiceProvider;
  /** Vendor-shaped registration fields prepared by the KRA registration mapper (Phase 6). */
  registration: Record<string, unknown>;
}

export interface KraRegistrationResult {
  requestId?: string;
  pan?: string;
  status?: string;
  kraStatusCode?: string;
  statusDescription?: string;
  kraStatusDescription?: string;
  kraEntryDate?: IsoDate;
  documentUploadStatus?: string;
  queuedForRetry?: boolean;
  error?: {
    code?: string;
    message?: string;
    columns?: { column?: string; message?: string }[];
  };
  raw: unknown;
}

export interface KraDocumentQuery {
  pan: string;
  dob?: IsoDate;
  refNo?: string;
  kraCode: string;
  serviceProvider: KraServiceProvider;
}

/** Digio KRA operations, in domain terms. Implemented by infrastructure/partners/digio/kra. */
export interface KraGatewayPort {
  checkPanStatus(query: KraPanQuery): Promise<KraStatusResult>;
  fetchDetails(
    query: KraPanQuery & { dob: IsoDate },
    opts?: { deserializeCodes?: boolean },
  ): Promise<KraRecord>;
  register(command: KraRegistrationCommand): Promise<KraRegistrationResult>;
  downloadDocuments(query: KraDocumentQuery): Promise<Buffer>;
}
export const KRA_GATEWAY = Symbol('KRA_GATEWAY');
