import { Inject, Injectable } from '@nestjs/common';
import type {
  FaceGatewayPort,
  FaceMatchResult,
  LivenessResult,
} from '../../../../application/ports/face-gateway.port';
import { partnersConfig } from '../../../../common/config/partners.config';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { DigioGatewayBase } from '../digio-gateway.base';

export const FACE_PATHS = {
  liveness: '/v3/client/kyc/analyze/file/liveness',
  faceMatch: '/v3/client/kyc/facematch',
} as const;

interface ValidationCheckResponse {
  score?: number;
  result?: string;
  errors?: string[];
}
interface FaceMatchResponse {
  confidence?: number;
  match_result?: string;
  result?: string;
}

/** Digio face authentication APIs (multipart). Docs: documentation.digio.in/digikyc/face_authentication */
@Injectable()
export class DigioFaceGateway
  extends DigioGatewayBase
  implements FaceGatewayPort
{
  constructor(
    http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    super(http, cfg.digio);
  }

  async liveness(
    image: Buffer,
    contentType: string,
    uniqueRequestId: string,
  ): Promise<LivenessResult> {
    const form = new FormData();
    form.append(
      'image',
      new Blob([new Uint8Array(image)], { type: contentType }),
      'image',
    );
    form.append('unique_request_id', uniqueRequestId);
    const res = await this.post<ValidationCheckResponse>(
      'face.liveness',
      FACE_PATHS.liveness,
      form,
      { bodyType: 'multipart', referenceId: uniqueRequestId },
    );
    const result = res.data?.result;
    return {
      result: result === 'PASS' || result === 'FAIL' ? result : 'UNKNOWN',
      score: Number(res.data?.score ?? 0),
      errors: res.data?.errors ?? [],
      raw: res.data,
    };
  }

  async faceMatch(
    a: Buffer,
    b: Buffer,
    contentType: string,
    minimumMatch: number,
    uniqueRequestId: string,
  ): Promise<FaceMatchResult> {
    const form = new FormData();
    form.append(
      'file1',
      new Blob([new Uint8Array(a)], { type: contentType }),
      'file1',
    );
    form.append(
      'file2',
      new Blob([new Uint8Array(b)], { type: contentType }),
      'file2',
    );
    form.append('minimum_match', String(minimumMatch));
    form.append('unique_request_id', uniqueRequestId);
    const res = await this.post<FaceMatchResponse>(
      'face.match',
      FACE_PATHS.faceMatch,
      form,
      { bodyType: 'multipart', referenceId: uniqueRequestId },
    );
    // The documented examples use both `match_result` and `result` for the verdict.
    const verdict = res.data?.match_result ?? res.data?.result;
    const matchResult =
      verdict === 'matched' || verdict === 'not_matched' || verdict === 'failed'
        ? verdict
        : 'none';
    return {
      matchResult,
      confidence: Number(res.data?.confidence ?? 0),
      raw: res.data,
    };
  }
}
