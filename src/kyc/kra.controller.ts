import {
  Body,
  Controller,
  Headers,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { DigioExceptionFilter } from '../connectors/digio/digio-exception.filter';
import { DigioKraConnector } from '../connectors/digio/kra/kra.connector';
import type {
  KraCheckPanStatusRequest,
  KraCheckPanStatusResponse,
  KraFetchDetailsRequest,
  KraFetchDetailsResponse,
  KraUploadDetailsRequest,
  KraUploadDetailsResponse,
} from '../connectors/digio/kra/kra.types';

/**
 * HTTP surface over the Digio KRA connector. Bodies are passed through in
 * Digio's own snake_case shape; see src/connectors/digio/kra/kra.types.ts.
 * An optional `X-Reference-Id` header is forwarded to Digio as X_REFERENCE_ID.
 */
@Controller('kyc/kra')
@UseFilters(DigioExceptionFilter)
export class KraController {
  constructor(private readonly kra: DigioKraConnector) {}

  @Post('pan-status')
  checkPanStatus(
    @Body() body: KraCheckPanStatusRequest,
    @Headers('x-reference-id') referenceId?: string,
  ): Promise<KraCheckPanStatusResponse> {
    return this.kra.checkPanStatus(body, { referenceId });
  }

  @Post('details')
  fetchDetails(
    @Body() body: KraFetchDetailsRequest,
    @Query('deserialize_codes') deserializeCodes?: string,
    @Headers('x-reference-id') referenceId?: string,
  ): Promise<KraFetchDetailsResponse> {
    return this.kra.fetchDetails(body, {
      referenceId,
      deserializeCodes:
        deserializeCodes === undefined
          ? undefined
          : deserializeCodes === 'true',
    });
  }

  @Post('upload')
  uploadDetails(
    @Body() body: KraUploadDetailsRequest,
    @Headers('x-reference-id') referenceId?: string,
  ): Promise<KraUploadDetailsResponse> {
    return this.kra.uploadDetails(body, { referenceId });
  }
}
