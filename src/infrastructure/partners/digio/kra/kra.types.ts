/**
 * Types for Digio DigiKYC KRA APIs.
 * Source: https://documentation.digio.in/digikyc/kra/api_integration/
 * Field names mirror the wire format (snake_case) used in Digio's request and
 * response examples.
 */

export type KraServiceProvider = 'NDML' | 'CDSL' | 'CAMS';

/** I = Individual, E = Entity (non-individual). */
export type KraFetchType = 'I' | 'E';

export type KraApiRequestType = 'stateless' | 'workflow' | 'stateless_async';

/* ------------------------------------------------------------------ */
/* Shared request (used by Check PAN Status and Fetch Details)          */
/* ------------------------------------------------------------------ */

/** KraCheckPanDetailRequest in Digio's spec. */
export interface KraPanRequest {
  /** PAN of the individual / entity. Required. */
  pan_no: string;
  /** DD/MM/YYYY. Date of birth (individual) or date of incorporation (entity). */
  dob?: string;
  fetch_type?: KraFetchType;
  /**
   * Unique id for traceability and reconciliation. Digio asks for one per
   * request; the connector generates a UUID when omitted.
   */
  unique_request_id?: string;
  service_provider?: KraServiceProvider;
  mobile?: string;
}

/* ------------------------------------------------------------------ */
/* 1. Check PAN Status  POST /v3/client/kyc/kra/v2/get_pan_status      */
/* ------------------------------------------------------------------ */

export type KraCheckPanStatusRequest = KraPanRequest;

/** PanStatusResponse in Digio's spec (wire format is snake_case). */
export interface KraCheckPanStatusResponse {
  pan_number?: string;
  name?: string;
  /** 3-digit KYC status; first digit identifies the KRA holding the record. */
  status_code?: string;
  status?: string;
  status_description?: string;
  kra_status_code?: string;
  status_date?: string;
  entry_date?: string;
  modification_date?: string;
  status_delta?: string;
  update_status?: string;
  update_status_description?: string;
  hold_deactivation_remarks?: string;
  update_remarks?: string;
  /** 0-5, see KycMode. */
  kyc_mode?: string;
  kyc_mode_description?: string;
  /** Y / N / E (exempted). */
  ipv_flag?: string;
  ubo_flag?: string;
  permanent_address_proof?: string;
  correspondence_address_proof?: string;
  batch_id?: string;
  response_date?: string;
  total_records?: string;
  /** CAMS only: Y/N whether investor signature is uploaded. */
  sign_flag?: string;
  /** Digio reference for tracking. */
  ref_id?: string;
}

/* ------------------------------------------------------------------ */
/* 2. Fetch Details  POST /v3/client/kyc/kra/download_pan              */
/* ------------------------------------------------------------------ */

export type KraFetchDetailsRequest = KraPanRequest;

export interface KraAddressDetails {
  address_line1?: string;
  address_line2?: string;
  address_line3?: string;
  city?: string;
  /** State code. */
  state?: string;
  /** Country code. */
  country?: string;
  pin_code?: string;
  address_proof_date?: string;
  address_proof?: string;
  address_reference?: string;
}

export interface KraPersonalInformation {
  pan_number?: string;
  name?: string;
  dob?: string;
  gender?: string;
  father_name?: string;
  nationality?: string;
  other_nationality?: string;
  residential_status?: string;
  residential_status_proof?: string;
  uid_number?: string;
}

export interface KraContactInformation {
  mobile_number?: string;
  fax_number?: string;
  office_contact_number?: string;
  residential_contact_number?: string;
  email_address?: string;
  correspondence_address?: KraAddressDetails;
  permanent_address?: KraAddressDetails;
}

export interface KraCompanyInformation {
  company_status?: string;
  other_company_status?: string;
  incorporation_place?: string;
}

export interface KraFinancialInformation {
  income?: string;
  occupation?: string;
  other_occupation?: string;
  political_connection?: string;
  net_worth?: string;
  net_worth_date?: string;
}

export interface KraRequestTracingDetails {
  application_date?: string;
  commencement_date?: string;
  download_date?: string;
  data_dump_type?: string;
}

export interface KraAccountDetails {
  account_open_date?: string;
  account_active_date?: string;
  account_update_date?: string;
  filler_field1?: string;
  filler_field2?: string;
  filler_field3?: string;
}

export interface KraFatcaDetails {
  applicable?: string;
  birth_place?: string;
  birth_country?: string;
  country_residence?: string;
  country_citizenship?: string;
  entity_pan?: string;
  country_residency?: string;
  tax_identification_no?: string;
  tax_identification_type?: string;
  tax_exempt_flag?: string;
  tax_exempt_reason?: string;
  date_declaration?: string;
  number_of_records?: string;
}

export interface KraInformation {
  kra_info?: string;
  other_kra_code?: string;
  kra_batch_id?: string;
  request_date?: string;
  response_date?: string;
  total_records?: string;
  other_information?: string;
}

export interface KraKycInformation {
  kyc_mode?: string;
  kyc_mode_description?: string;
  ipv_flag?: string;
  ipv_date?: string;
  status?: string;
  status_code?: string;
  status_description?: string;
  status_date?: string;
  document_proof?: string;
  internal_reference?: string;
  branch_code?: string;
  uid_token?: string;
  version_number?: string;
  iop_flag?: string;
  signature?: string;
  marital_status?: string;
  remarks?: string;
}

export interface KraKycAdditionalDetails {
  entity_pan?: string;
  additional_pan?: string;
  data_name?: string;
  din_number?: string;
  relation_ship?: string;
  political_connection?: string;
  residential_address1?: string;
  residential_address2?: string;
  residential_address3?: string;
  residential_city?: string;
  residential_pincode?: string;
  residential_state?: string;
  country_residency?: string;
  filler1?: string;
  filler2?: string;
  filler3?: string;
}

export interface KraErrorDetails {
  /** e.g. "ERR-00000" for success. See KRA error codes page. */
  error_description?: string;
  error_code?: string;
  error_description_additional?: string;
}

/** DownloadPanResponse in Digio's spec. */
export interface KraFetchDetailsResponse {
  pos_code?: string;
  /** I = Individual, N = Non-Individual. */
  application_type?: string;
  application_number?: string;
  pan_copy?: string;
  exempt_status?: string;
  exempt_category?: string;
  exempt_id_proof?: string;
  registration_number?: string;
  personal_information?: KraPersonalInformation;
  contact_information?: KraContactInformation;
  company_information?: KraCompanyInformation;
  financial_information?: KraFinancialInformation;
  request_tracing_details?: KraRequestTracingDetails;
  account_details?: KraAccountDetails;
  fatca_details?: KraFatcaDetails;
  kra_information?: KraInformation;
  kyc_information?: KraKycInformation;
  kyc_additional_details?: KraKycAdditionalDetails[];
  error_details?: KraErrorDetails;
  ref_id?: string;
}

/* ------------------------------------------------------------------ */
/* 3. Upload Details  POST /v3/client/kyc/kra/app/register             */
/* ------------------------------------------------------------------ */

export interface KraFatcaAdditionalDetails {
  app_fatca_entity_pan?: string;
  app_fatca_country_residency?: string;
  app_fatca_tax_identification_type?: string;
  app_fatca_tax_identification_number?: string;
  app_fatca_tax_exempt_flag?: string;
  app_fatca_tax_exempt_reason?: string;
}

export interface KraAdditionalDetails {
  app_addldata_updtflg?: string;
  app_entity_pan?: string;
  app_addldata_pan?: string;
  app_addldata_name?: string;
  app_addldata_din_uid?: string;
  app_addldata_id_type?: 'UID' | 'DIN';
  app_addldata_relationship?: string;
  app_addldata_polconn?: string;
  app_adddata_regdadd1?: string;
  app_appdata_regdadd2?: string;
  app_appdata_regdadd3?: string;
  app_adddata_city?: string;
  app_adddata_pincd?: string;
  app_adddata_state?: string;
  app_adddata_country?: string;
  app_addldata_filler1?: string;
  app_addldata_filler2?: string;
  app_addldata_filler3?: string;
}

/**
 * CommonKraRegistrationRequest in Digio's spec. All fields are strings on the
 * wire; coded values (occupation, income, update_flag, ...) are documented on
 * https://documentation.digio.in/digikyc/kra/api_integration/upload_details/
 *
 * Note (CVL KRA, effective 1 Aug 2025): PAN is no longer accepted as proof of
 * identity. Send pan_copy "N" and an app_exmt_id_proof other than "01"
 * (e.g. "02" for UID).
 */
export interface KraCommonRegistrationRequest {
  uid_no?: string;
  pan_no: string;
  /** dd/mm/yyyy */
  dob_date?: string;
  /** dd/mm/yyyy, not in the future */
  ipv_date?: string;
  /** M / F / T */
  gender?: string;
  /** 01 Married, 02 Unmarried */
  martial_status?: string;
  /** 01..10, 99 Others */
  occupation?: string;
  mob_no?: string;
  fax_no?: string;
  email?: string;
  per_add1?: string;
  per_add2?: string;
  per_add3?: string;
  per_city?: string;
  per_pincode?: string;
  per_state?: string;
  per_country?: string;
  per_district?: string;
  per_add_proof?: string;
  /** Y / N */
  pan_copy?: string;
  applicant_name?: string;
  father_name?: string;
  applicant_citizenship?: string;
  applicant_other_citizen?: string;
  comm_addr1?: string;
  comm_addr2?: string;
  comm_addr3?: string;
  comm_pincode?: string;
  comm_city?: string;
  comm_state?: string;
  comm_country?: string;
  comm_tell_no_off_code?: string;
  comm_tell_no_off?: string;
  comm_tell_no_res_code?: string;
  comm_tell_no_res?: string;
  comm_mobile_no_code?: string;
  comm_addr_type?: string;
  comm_addr_proof?: string;
  comm_ident_no?: string;
  per_ident_no?: string;
  fatca_place_birth?: string;
  fatca_country_birth?: string;
  fatca_tin?: string;
  application_type?: string;
  ipv_emp_designation?: string;
  ipv_emp_name?: string;
  ipv_institution_name?: string;
  kyc_date?: string;
  /** Base64 of e-signed form */
  doc_esign_form?: string;
  /** 0 Normal, 1 eKYC OTP, 2 eKYC Biometric, 3 Online+IPV, 4 Offline Aadhaar, 5 Digilocker */
  kyc_mode?: string;
  kyc_type?: string;
  app_upload_type?: string;
  app_amc?: string;
  app_applicant_title?: string;
  app_relationship?: string;
  app_father_title?: string;
  app_mother_title?: string;
  app_ipv_done_by?: string;
  app_mother_name?: string;
  app_maiden_title?: string;
  app_maiden_name?: string;
  app_applicant_status?: string;
  app_id_proof?: string;
  app_id_proof_identno?: string;
  app_applicant_kycno?: string;
  app_ipv_institution_code?: string;
  app_applicant_kyc_acc_type?: string;
  app_comm_district?: string;
  app_comm_fax_code?: string;
  app_comm_addr_proof_exp_date?: string;
  app_per_addr_proof_exp_date?: string;
  app_fatca_tax_jurisdiction?: string;
  app_fatca_countryof_jurisdiction?: string;
  app_fatca_addr1?: string;
  app_fatca_addr2?: string;
  app_fatca_addr3?: string;
  app_fatca_pincode?: string;
  app_fatca_city?: string;
  app_fatca_district?: string;
  app_fatca_state?: string;
  app_fatca_rel_person?: string;
  app_rel_per_kycno?: string;
  app_rel_per_title?: string;
  relative_name?: string;
  app_rel_per_type?: string;
  app_rel_per_addr_type?: string;
  app_rel_per_addr_type_exp_date?: string;
  app_rel_per_ident_no?: string;
  app_dob_declaration?: string;
  app_place_declaration?: string;
  app_doc_pan?: string;
  app_doc_addr_proof?: string;
  app_doc_photo?: string;
  app_doc_cancelled_chq?: string;
  app_doc_sign?: string;
  app_doc_per_ver_video?: string;
  app_ipv_emp_code?: string;
  app_ipv_emp_branch?: string;
  app_ipv_institution_name?: string;
  app_kyc_emp_name?: string;
  app_kyc_emp_code?: string;
  app_kyc_emp_branch?: string;
  app_kyc_emp_designation?: string;
  app_kyc_institution_code?: string;
  app_kyc_institution_name?: string;
  kra_info?: string;
  aadhaar_passcode?: string;
  aadhaar_digit?: string;
  app_source_doc?: string;
  app_auth_qc_flag?: string;
  app_ipv_emp_no?: string;
  app_fatca_country_residency1?: string;
  app_fatca_tax_identification_no1?: string;
  app_fatca_tax_exempt_flag1?: string;
  app_fatca_tax_exempt_reason1?: string;
  app_fatca_country_residency2?: string;
  app_fatca_tax_identification_no2?: string;
  app_fatca_tax_exempt_flag2?: string;
  app_fatca_tax_exempt_reason2?: string;
  app_fatca_country_residency3?: string;
  app_fatca_tax_identification_no3?: string;
  app_fatca_tax_exempt_flag3?: string;
  app_fatca_tax_exempt_reason3?: string;
  app_fatca_country_residency4?: string;
  app_fatca_tax_identification_no4?: string;
  app_fatca_tax_exempt_flag4?: string;
  app_fatca_tax_exempt_reason4?: string;
  app_req_type?: string;
  app_communication_address_doc?: string;
  app_ipv_doc_received?: string;
  app_doc_source?: string;
  app_residential_status?: string;
  /** Exemption category 01..08, 11. Mandatory when app_exmt = Y. */
  app_exmt_cat?: string;
  /** 01 New, 02 Modify w/ docs, 03 Modify w/o docs, 04 Dump, 05 Suspended, 06 Deceased, 07 Old KYC, 11 Old KYC Modification, 99 Interop Modification */
  update_flag?: string;
  /** CVLKRA | NDML | DOTEX | CAMS | KARVY | BSE */
  kra_code?: string;
  pos_code?: string;
  app_no?: string;
  /** Y / N */
  app_exmt?: string;
  /** Identity proof code 01..13, 16. Must not be 01 (PAN) for CVL KRA since 1 Aug 2025. */
  app_exmt_id_proof?: string;
  /** Y / N / E */
  ipv_flag?: string;
  reg_no?: string;
  /** dd/mm/yyyy, non-individual */
  dob_incorp?: string;
  commence_date?: string;
  /** 01 Indian, 02 Others */
  nationality?: string;
  other_nationality?: string;
  comp_status?: string;
  oth_comp_status?: string;
  res_status_proof?: string;
  off_isd?: string;
  off_std?: string;
  res_isd?: string;
  res_std?: string;
  res_no?: string;
  mob_isd?: string;
  fax_isd?: string;
  fax_std?: string;
  cor_add_date?: string;
  /** Y / N */
  per_add_flag?: string;
  per_add_date?: string;
  /** 01..07 */
  income?: string;
  other_occupation?: string;
  /** NA | RPEP | PEP */
  pol_conn?: string;
  /** S | T */
  doc_proof?: string;
  internal_ref?: string;
  branch_code?: string;
  net_worth?: string;
  net_worth_date?: string;
  incorp_plc?: string;
  other_info?: string;
  acc_open_date?: string;
  acc_active_date?: string;
  acc_update_date?: string;
  vid_no?: string;
  uid_token?: string;
  auth_name?: string;
  auth_email?: string;
  auth_email1?: string;
  auth_email2?: string;
  auth_mobile?: string;
  auth_fpi_consent?: string;
  auth_ubo_consent?: string;
  mobile_flag?: string;
  email_flag?: string;
  otp_ref_no?: string;
  corr_district?: string;
  /** Y / N */
  fatca_applicable?: string;
  app_fatca_date_declaration?: string;
  fatca_additional_details?: KraFatcaAdditionalDetails[];
  additional_details?: KraAdditionalDetails[];
  /** Base64: PAN copy or e-signed PDF */
  kyc_document?: string;
  /** Base64 Aadhaar copy; either this or aadhaar_xml is mandatory */
  aadhaar_document?: string;
  aadhaar_xml?: string;
  uidai_refno?: string;
  ubo_applicable?: string;
  ubo_date?: string;
  ubo_exempt_reason?: string;
  ubo_dod?: string;
  shp_applicable?: string;
  shp_date?: string;
  shp_dod?: string;
  bs_applicable?: string;
  bs_date1?: string;
  bs_date2?: string;
  bs_dod?: string;
  /** Mandatory: country of first citizenship */
  app_fatca_country?: string;
  non_individual_ubo?: string;
  non_individual_shp?: string;
  non_individual_bs?: string;
}

/** KraRegisterPanDetailRequest in Digio's spec. */
export interface KraUploadDetailsRequest {
  common_kra_registration_request: KraCommonRegistrationRequest;
  /** Generated by the connector when omitted. */
  unique_request_id?: string;
  api_request_type?: KraApiRequestType;
  service_provider?: KraServiceProvider;
  /** Digio spec types this as a single enum value although the description says "list". */
  kra_providers?: KraServiceProvider;
}

export interface KraColumnError {
  column_name?: string;
  error_message?: string;
}

export interface KraRegistrationError {
  error_message?: string;
  /** e.g. ERR-90019 */
  error_code?: string;
  additional_errors?: KraColumnError[];
}

export type KraDocumentUploadStatus =
  'DOCUMENT_PENDING' | 'UPLOAD_PENDING' | 'UPLOAD_SUCCESS' | 'UPLOAD_FAILED';

/** KraRegistrationResponse in Digio's spec. */
export interface KraUploadDetailsResponse {
  service_provider?: KraServiceProvider;
  request_id?: string;
  pan_number?: string;
  date_of_birth?: string;
  name?: string;
  /** Digio status, e.g. VALIDATION_ERROR, SUBMITTED, KRA_VERIFIED */
  status?: string;
  remarks?: string;
  kra_status_code?: string;
  ack?: string;
  status_description?: string;
  kra_status_description?: string;
  kra_entry_date?: string;
  kra_pos_code?: string;
  response_date?: string;
  total_records_count?: string;
  error?: KraRegistrationError;
  document_upload_status?: KraDocumentUploadStatus;
  queued_for_retry?: boolean;
}

/* ------------------------------------------------------------------ */
/* Webhook payload (KRA.PAN.STATUS.UPDATE)                              */
/* ------------------------------------------------------------------ */

export type KraWebhookStatus =
  | 'NOT_CHECKED_WITH_RESPECTIVE_KRA'
  | 'SUBMITTED'
  | 'KRA_VERIFIED'
  | 'ON_HOLD'
  | 'REJECTED'
  | 'NOT_AVAILABLE'
  | 'DEACTIVATED'
  | 'KRA_VALIDATED'
  | 'EXISTING_KYC_SUBMITTED'
  | 'EXISTING_KYC_VERIFIED'
  | 'EXISTING_KYC_HOLD'
  | 'EXISTING_KYC_REJECTED'
  | 'KYC_REGISTERED_WITH_CVLMF'
  | 'NOT_CHECKED_WITH_MULTIPLE_KRA'
  | 'INVALID_PAN_FORMAT'
  | 'KRA_NOT_REACHABLE';

export interface KraRegisterWebhookEntity {
  id: string;
  request_id: string;
  /** One of {@link KraWebhookStatus}; typed as string so new Digio statuses do not break parsing. */
  status: string;
  pan_number: string;
  kra_provider: string;
  client_reference_id?: string;
  metadata?: unknown[];
  others?: unknown;
}

export interface KraWebhookPayload {
  entities: ['kra_register'];
  payload: { kra_register: KraRegisterWebhookEntity };
}
