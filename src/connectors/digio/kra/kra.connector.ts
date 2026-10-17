import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { digioConfig } from '../../../config/digio.config';
import { DigioHttpClient } from '../digio-http.client';
import { DigioValidationError } from '../digio.errors';
import type {
  KraCheckPanStatusRequest,
  KraCheckPanStatusResponse,
  KraCommonRegistrationRequest,
  KraFetchDetailsRequest,
  KraFetchDetailsResponse,
  KraPanRequest,
  KraUploadDetailsRequest,
  KraUploadDetailsResponse,
} from './kra.types';

export const KRA_ENDPOINTS = {
  /** https://documentation.digio.in/digikyc/kra/api_integration/check_pan_status/ */
  checkPanStatus: '/v3/client/kyc/kra/v2/get_pan_status',
  /** https://documentation.digio.in/digikyc/kra/api_integration/fetch_details/ */
  fetchDetails: '/v3/client/kyc/kra/download_pan',
  /** https://documentation.digio.in/digikyc/kra/api_integration/upload_details/ */
  uploadDetails: '/v3/client/kyc/kra/app/register',
} as const;

export interface KraCallOptions {
  /**
   * Value for Digio's X_REFERENCE_ID header. Defaults to the request's
   * unique_request_id so one id traces the call end to end.
   */
  referenceId?: string;
}

export interface KraFetchDetailsOptions extends KraCallOptions {
  /** Ask Digio to expand coded values (state, country, occupation, ...). */
  deserializeCodes?: boolean;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DDMMYYYY_RE = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;

/** Fields of the registration payload documented as dd/mm/yyyy. */
const REGISTRATION_DATE_FIELDS: (keyof KraCommonRegistrationRequest)[] = [
  'dob_date',
  'ipv_date',
  'dob_incorp',
  'commence_date',
  'cor_add_date',
  'per_add_date',
  'net_worth_date',
  'app_fatca_date_declaration',
];

/**
 * Connector for Digio's DigiKYC KRA (KYC Registration Agency) APIs.
 * Docs: https://documentation.digio.in/digikyc/kra/api_integration/
 *
 * Every method validates the obviously-wrong inputs locally (PAN format,
 * date format, required fields), fills `unique_request_id` when missing and
 * delegates to {@link DigioHttpClient}, which handles auth and error mapping.
 */
@Injectable()
export class DigioKraConnector {
  constructor(
    private readonly http: DigioHttpClient,
    @Inject(digioConfig.KEY)
    private readonly config: Pick<
      ConfigType<typeof digioConfig>,
      'kraDefaultServiceProvider'
    >,
  ) {}

  /**
   * Check the current KYC status of a single PAN.
   * POST /v3/client/kyc/kra/v2/get_pan_status
   */
  async checkPanStatus(
    request: KraCheckPanStatusRequest,
    options: KraCallOptions = {},
  ): Promise<KraCheckPanStatusResponse> {
    const body = this.preparePanRequest(request, { requireDob: false });
    return this.http.post<KraCheckPanStatusResponse>(
      KRA_ENDPOINTS.checkPanStatus,
      body,
      { referenceId: options.referenceId ?? body.unique_request_id },
    );
  }

  /**
   * Fetch the full KYC record of an individual (PAN + date of birth) or an
   * entity (PAN + date of incorporation).
   * POST /v3/client/kyc/kra/download_pan
   */
  async fetchDetails(
    request: KraFetchDetailsRequest,
    options: KraFetchDetailsOptions = {},
  ): Promise<KraFetchDetailsResponse> {
    const body = this.preparePanRequest(request, { requireDob: true });
    return this.http.post<KraFetchDetailsResponse>(
      KRA_ENDPOINTS.fetchDetails,
      body,
      {
        referenceId: options.referenceId ?? body.unique_request_id,
        query:
          options.deserializeCodes === undefined
            ? undefined
            : { deserialize_codes: options.deserializeCodes },
      },
    );
  }

  /**
   * Upload (new) or update (existing) KYC details of an individual/entity
   * on the KRA.
   * POST /v3/client/kyc/kra/app/register
   */
  async uploadDetails(
    request: KraUploadDetailsRequest,
    options: KraCallOptions = {},
  ): Promise<KraUploadDetailsResponse> {
    const common = request?.common_kra_registration_request;
    if (!common || typeof common !== 'object') {
      throw new DigioValidationError(
        'common_kra_registration_request is required',
        'common_kra_registration_request',
      );
    }

    const panNo = normalisePan(
      common.pan_no,
      'common_kra_registration_request.pan_no',
    );
    for (const field of REGISTRATION_DATE_FIELDS) {
      const value = common[field];
      if (typeof value === 'string' && value !== '') {
        assertDdMmYyyy(value, `common_kra_registration_request.${field}`);
      }
    }

    const body: KraUploadDetailsRequest = {
      ...request,
      unique_request_id: request.unique_request_id ?? randomUUID(),
      service_provider:
        request.service_provider ?? this.config.kraDefaultServiceProvider,
      common_kra_registration_request: { ...common, pan_no: panNo },
    };
    if (body.service_provider === undefined) delete body.service_provider;

    return this.http.post<KraUploadDetailsResponse>(
      KRA_ENDPOINTS.uploadDetails,
      body,
      { referenceId: options.referenceId ?? body.unique_request_id },
    );
  }

  private preparePanRequest(
    request: KraPanRequest,
    { requireDob }: { requireDob: boolean },
  ): KraPanRequest & { unique_request_id: string } {
    const panNo = normalisePan(request?.pan_no, 'pan_no');

    if (requireDob && !request.dob) {
      throw new DigioValidationError(
        'dob (date of birth / incorporation, DD/MM/YYYY) is required',
        'dob',
      );
    }
    if (request.dob !== undefined) assertDdMmYyyy(request.dob, 'dob');

    const body: KraPanRequest & { unique_request_id: string } = {
      ...request,
      pan_no: panNo,
      unique_request_id: request.unique_request_id ?? randomUUID(),
      service_provider:
        request.service_provider ?? this.config.kraDefaultServiceProvider,
    };
    if (body.service_provider === undefined) delete body.service_provider;
    return body;
  }
}

function normalisePan(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DigioValidationError(`${field} is required`, field);
  }
  const pan = value.trim().toUpperCase();
  if (!PAN_RE.test(pan)) {
    throw new DigioValidationError(
      `${field} must be a valid PAN (e.g. ABCDE1234F)`,
      field,
    );
  }
  return pan;
}

function assertDdMmYyyy(value: string, field: string): void {
  if (!DDMMYYYY_RE.test(value)) {
    throw new DigioValidationError(
      `${field} must be in DD/MM/YYYY format`,
      field,
    );
  }
}
