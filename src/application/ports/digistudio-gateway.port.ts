export interface CreateKycRequestCommand {
  /** Customer email or mobile as Digio expects (mobile digits without +). */
  customerIdentifier: string;
  customerName?: string;
  referenceId: string;
  transactionId: string;
  templateName: string;
  expireInDays?: number;
}

export interface KycRequestCreated {
  providerRequestId: string;
  status: string;
  accessToken?: { id: string; validTill?: string };
  raw: unknown;
}

export interface KycRequestAction {
  id?: string;
  stepRequestId?: string;
  type?: string;
  status?: string;
  optional?: boolean;
  processingDone?: boolean;
  faceMatchStatus?: string;
  validationResult?: unknown;
}

export interface KycRequestStatus {
  providerRequestId: string;
  status: string;
  actions: KycRequestAction[];
  raw: unknown;
}

export interface DigiStudioGatewayPort {
  createRequest(cmd: CreateKycRequestCommand): Promise<KycRequestCreated>;
  getStatus(providerRequestId: string): Promise<KycRequestStatus>;
  downloadMedia(fileId: string): Promise<{ data: Buffer; contentType: string }>;
  /** New SDK access token for an existing request (POST /user/auth/generate_token). */
  regenerateAccessToken(
    providerRequestId: string,
  ): Promise<{ id: string; validTill?: string }>;
}
export const DIGISTUDIO_GATEWAY = Symbol('DIGISTUDIO_GATEWAY');
