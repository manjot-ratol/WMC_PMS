export interface CkycRegisterCommand {
  /** Vendor-shaped `register_ckyc_request` prepared by the CKYC mapper. */
  registration: Record<string, unknown>;
  files: {
    field: string;
    fileName: string;
    contentType: string;
    data: Buffer;
  }[];
  uniqueRequestId: string;
}
export interface CkycRegisterResult {
  providerRequestId?: string;
  status?: string;
  ckycNumber?: string;
  raw: unknown;
}
export interface CkycGatewayPort {
  register(cmd: CkycRegisterCommand): Promise<CkycRegisterResult>;
}
export const CKYC_GATEWAY = Symbol('CKYC_GATEWAY');
