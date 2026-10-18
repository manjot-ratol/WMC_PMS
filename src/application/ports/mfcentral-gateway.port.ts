/** MF Central CAS (consolidated account statement) connector; wired into screen 06A (portfolio import) in Phase 9. */
export interface CasRequest {
  clientRefNo: string;
  reqId?: string;
  pan: string;
  pekrn?: string;
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
  /** Investor hand-off URL for the MF Central app once a request exists (STEP5 of the collection, no API). */
  buildRedirectUrl(reqId: string, clientRefNo: string): string;
  /** Decrypts a payload MF Central produced for us (the statement delivered to `redirectUrl`). */
  decrypt(encrypted: string): Promise<string>;
}
export const MFCENTRAL_GATEWAY = Symbol('MFCENTRAL_GATEWAY');

/** Encrypt / sign / decrypt as MF Central expects; swappable because the exact primitives are not documented. */
export interface MfCentralCryptoPort {
  encrypt(plainJson: string): Promise<string>;
  sign(encrypted: string): Promise<string>;
  decrypt(encrypted: string): Promise<string>;
}
