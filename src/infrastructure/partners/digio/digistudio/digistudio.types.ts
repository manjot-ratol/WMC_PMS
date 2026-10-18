/** Vendor wire types for DigiStudio (documentation.digio.in/digistudio/integration). */
export interface KycTemplateRequest {
  customer_identifier: string;
  customer_name?: string;
  reference_id: string;
  transaction_id: string;
  template_name: string;
  notify_customer: boolean;
  generate_access_token: boolean;
  expire_in_days?: number;
}

export interface KycActionResponse {
  id?: string;
  step_request_id?: string;
  action_ref?: string;
  type?: string;
  status?: string;
  optional?: boolean;
  processing_done?: boolean;
  face_match_status?: string;
  validation_result?: unknown;
  completed_at?: string;
  otp?: string;
}

export interface KycResponse {
  id: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  customer_identifier?: string;
  reference_id?: string;
  transaction_id?: string;
  workflow_name?: string;
  template_id?: string;
  actions?: KycActionResponse[];
  access_token?: {
    id: string;
    entity_id?: string;
    valid_till?: string;
    created_at?: string;
  };
  /** The status endpoint wraps the response in request_details. */
  request_details?: Partial<KycResponse>;
}
