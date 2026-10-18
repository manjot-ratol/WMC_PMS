export interface CreateSignRequestCommand {
  fileName: string;
  /** PDF bytes; the gateway base64-encodes for the wire. */
  file: Buffer;
  signer: { identifier: string; name: string; reason: string };
  expireInDays: number;
  /** Our application id (Digio `reference_id`). */
  referenceId: string;
  /** Our session id (Digio `custom_reference`). */
  customReference: string;
}
export interface SignRequestCreated {
  providerDocumentId: string;
  agreementStatus: string;
  accessToken?: { id: string; validTill?: string };
  raw: unknown;
}
export interface SignDocumentStatus {
  providerDocumentId: string;
  agreementStatus: string;
  signers: { identifier?: string; name?: string; status?: string }[];
  raw: unknown;
}
export interface EsignGatewayPort {
  createSignRequest(cmd: CreateSignRequestCommand): Promise<SignRequestCreated>;
  getDocument(providerDocumentId: string): Promise<SignDocumentStatus>;
  downloadSigned(providerDocumentId: string): Promise<Buffer>;
  cancel(providerDocumentId: string, reason: string): Promise<void>;
}
export const ESIGN_GATEWAY = Symbol('ESIGN_GATEWAY');
