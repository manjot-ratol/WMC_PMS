import type {
  CreateKycRequestCommand,
  KycRequestCreated,
  KycRequestStatus,
} from '../../../../application/ports/digistudio-gateway.port';
import type { KycResponse, KycTemplateRequest } from './digistudio.types';

export function toTemplateRequest(
  cmd: CreateKycRequestCommand,
): KycTemplateRequest {
  return {
    customer_identifier: cmd.customerIdentifier,
    customer_name: cmd.customerName,
    reference_id: cmd.referenceId,
    transaction_id: cmd.transactionId,
    template_name: cmd.templateName,
    notify_customer: false,
    generate_access_token: true,
    expire_in_days: cmd.expireInDays,
  };
}

/** Strips the access token and action OTPs from what is retained as evidence. */
export function redactForEvidence(r: KycResponse): KycResponse {
  const copy: KycResponse = { ...r };
  delete copy.access_token;
  copy.actions = r.actions?.map((a) => {
    const action = { ...a };
    delete action.otp;
    return action;
  });
  return copy;
}

export function fromCreateResponse(r: KycResponse): KycRequestCreated {
  return {
    providerRequestId: r.id,
    status: r.status,
    accessToken: r.access_token
      ? { id: r.access_token.id, validTill: r.access_token.valid_till }
      : undefined,
    raw: redactForEvidence(r),
  };
}

export function fromStatusResponse(
  r: KycResponse,
  fallbackId: string,
): KycRequestStatus {
  const body =
    r.request_details && !r.status
      ? {
          ...r.request_details,
          actions: r.request_details.actions ?? r.actions,
        }
      : r;
  return {
    providerRequestId: body.id ?? fallbackId,
    status: body.status ?? 'unknown',
    actions: (body.actions ?? []).map((a) => ({
      id: a.id,
      stepRequestId: a.step_request_id,
      type: a.type,
      status: a.status,
      optional: a.optional,
      processingDone: a.processing_done,
      faceMatchStatus: a.face_match_status,
      validationResult: a.validation_result,
    })),
    raw: redactForEvidence(body as KycResponse),
  };
}
