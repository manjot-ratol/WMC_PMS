import type {
  KraDocumentQuery,
  KraPanQuery,
  KraRecord,
  KraRegistrationCommand,
  KraRegistrationResult,
  KraStatusResult,
} from '../../../../application/ports/kra-gateway.port';
import {
  formatDdMmYyyy,
  parseDdMmYyyy,
} from '../../../../domain/shared/iso-date';
import type {
  KraAddressDetails,
  KraCheckPanStatusResponse,
  KraFetchDetailsResponse,
  KraPanRequest,
  KraUploadDetailsRequest,
  KraUploadDetailsResponse,
} from './kra.types';

/* ---- requests (domain → vendor) ---- */

export function toPanRequest(q: KraPanQuery): KraPanRequest {
  return stripUndefined({
    pan_no: q.pan.trim().toUpperCase(),
    dob: q.dob ? formatDdMmYyyy(q.dob, '/') : undefined,
    fetch_type: q.fetchType,
    unique_request_id: q.uniqueRequestId,
    service_provider: q.serviceProvider,
  });
}

export function toRegisterRequest(
  c: KraRegistrationCommand,
): KraUploadDetailsRequest {
  return stripUndefined({
    unique_request_id: c.uniqueRequestId,
    api_request_type: c.apiRequestType,
    service_provider: c.serviceProvider,
    common_kra_registration_request:
      c.registration as unknown as KraUploadDetailsRequest['common_kra_registration_request'],
  });
}

export function toDocumentRequest(q: KraDocumentQuery): Record<string, string> {
  return stripUndefined<Record<string, string | undefined>>({
    pan_no: q.pan.trim().toUpperCase(),
    dob: q.dob ? formatDdMmYyyy(q.dob, '-') : undefined,
    ref_no: q.refNo,
    kraCode: q.kraCode,
    serviceProvider: q.serviceProvider,
  }) as Record<string, string>;
}

/* ---- responses (vendor → domain) ---- */

export function fromStatusResponse(
  r: KraCheckPanStatusResponse,
): KraStatusResult {
  return {
    pan: r.pan_number,
    name: r.name,
    statusCode: r.status_code,
    status: r.status,
    statusDescription: r.status_description,
    kraStatusCode: r.kra_status_code,
    statusDate: parseDdMmYyyy(r.status_date),
    entryDate: parseDdMmYyyy(r.entry_date),
    modificationDate: parseDdMmYyyy(r.modification_date),
    updateStatus: r.update_status,
    kycMode: r.kyc_mode,
    ipvFlag: r.ipv_flag,
    refId: r.ref_id,
    raw: r,
  };
}

export function fromFetchResponse(r: KraFetchDetailsResponse): KraRecord {
  const p = r.personal_information ?? {};
  const c = r.contact_information ?? {};
  const f = r.financial_information ?? {};
  const k = r.kyc_information ?? {};
  return {
    pan: p.pan_number,
    name: p.name,
    dob: parseDdMmYyyy(p.dob),
    gender: p.gender,
    fatherName: p.father_name,
    nationalityCode: p.nationality,
    residentialStatus: p.residential_status,
    applicationType: r.application_type,
    mobile: c.mobile_number,
    email: c.email_address,
    correspondenceAddress: toAddress(c.correspondence_address),
    permanentAddress: toAddress(c.permanent_address),
    incomeCode: f.income,
    occupationCode: f.occupation,
    politicalConnection: f.political_connection,
    kyc: {
      status: k.status,
      statusCode: k.status_code,
      statusDescription: k.status_description,
      statusDate: parseDdMmYyyy(k.status_date),
      ipvFlag: k.ipv_flag,
      ipvDate: parseDdMmYyyy(k.ipv_date),
      kycMode: k.kyc_mode,
      internalReference: k.internal_reference,
    },
    kraInfo: r.kra_information
      ? {
          kra: r.kra_information.kra_info,
          requestDate: parseDdMmYyyy(r.kra_information.request_date),
          responseDate: r.kra_information.response_date,
        }
      : undefined,
    error: r.error_details
      ? {
          code: r.error_details.error_code,
          description: r.error_details.error_description,
          additional: r.error_details.error_description_additional,
        }
      : undefined,
    refId: r.ref_id,
    raw: r,
  };
}

export function fromRegisterResponse(
  r: KraUploadDetailsResponse,
): KraRegistrationResult {
  return {
    requestId: r.request_id,
    pan: r.pan_number,
    status: r.status,
    kraStatusCode: r.kra_status_code,
    statusDescription: r.status_description,
    kraStatusDescription: r.kra_status_description,
    kraEntryDate: parseDdMmYyyy(r.kra_entry_date),
    documentUploadStatus: r.document_upload_status,
    queuedForRetry: r.queued_for_retry,
    error: r.error
      ? {
          code: r.error.error_code,
          message: r.error.error_message,
          columns: r.error.additional_errors?.map((e) => ({
            column: e.column_name,
            message: e.error_message,
          })),
        }
      : undefined,
    raw: r,
  };
}

function toAddress(a?: KraAddressDetails) {
  if (!a) return undefined;
  return {
    line1: a.address_line1,
    line2: a.address_line2,
    line3: a.address_line3,
    city: a.city,
    stateCode: a.state,
    countryCode: a.country,
    pinCode: a.pin_code,
    proofCode: a.address_proof,
    proofDate: parseDdMmYyyy(a.address_proof_date),
  };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}
