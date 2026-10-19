/** MF Central CAS (consolidated account statement) connector; wired into screen 06A (portfolio import) in Phase 9. */
export interface CasRequest {
  clientRefNo: string;
  reqId?: string;
  pan: string;
  pekrn?: string;
  /** Exactly one of email / mobile is sent; mobile takes precedence (vendor rule). */
  email?: string;
  mobile?: string;
  /** DD-MMM-YYYY; required for transaction data, blank for summary data. */
  fromDate?: string;
  toDate?: string;
  redirectUrl: string;
}
export interface CasRequestResult {
  reqId?: string;
  clientRefNo?: string;
  status?: string;
  /** UAT answers `{reqId, otpRef, userSubjectReference, clientRefNo}`: the OTP is sent to the investor by MF Central. */
  otpRef?: string;
  /** Decrypted vendor body, retained for the caller; never logged. */
  raw: unknown;
}
export interface ValidateQrRequest {
  clientRefNo: string;
  reqId: string;
  /** Base64 PNG as captured from the investor. */
  qrCode: string;
}
export interface MfCentralGatewayPort {
  newCasRequest(req: CasRequest): Promise<CasRequestResult>;
  validateQrCode(req: ValidateQrRequest): Promise<CasRequestResult>;
  /**
   * Investor hand-off (integration document step 2): the payload is AES-256-CBC encrypted with the URL key and
   * appended as `?data=` to `{appUrl}/api/auth/start`. MF Central then runs OTP, data choice and the QR download.
   */
  buildHandoffUrl(payload: HandoffPayload): string;
}
export interface HandoffPayload {
  reqId: string;
  otpRef: string;
  clientRefNo: string;
  pan: string;
  pekrn?: string;
  email?: string;
  mobile?: string;
  redirectUrl: string;
}
export const MFCENTRAL_GATEWAY = Symbol('MFCENTRAL_GATEWAY');

/** Encrypt / sign / decrypt as MF Central expects; swappable because the exact primitives are not documented. */
export interface MfCentralCryptoPort {
  encrypt(plainJson: string): Promise<string>;
  sign(encrypted: string): Promise<string>;
  decrypt(encrypted: string): Promise<string>;
}
