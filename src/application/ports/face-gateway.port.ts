export interface LivenessResult {
  result: 'PASS' | 'FAIL' | 'UNKNOWN';
  score: number;
  errors: string[];
  raw: unknown;
}
export interface FaceMatchResult {
  matchResult: 'matched' | 'not_matched' | 'failed' | 'none';
  confidence: number;
  raw: unknown;
}

export interface FaceGatewayPort {
  liveness(
    image: Buffer,
    contentType: string,
    uniqueRequestId: string,
  ): Promise<LivenessResult>;
  faceMatch(
    a: Buffer,
    b: Buffer,
    contentType: string,
    minimumMatch: number,
    uniqueRequestId: string,
  ): Promise<FaceMatchResult>;
}
export const FACE_GATEWAY = Symbol('FACE_GATEWAY');
