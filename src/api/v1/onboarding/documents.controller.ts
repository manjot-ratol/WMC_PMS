import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DocumentService } from '../../../application/documents/document.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  DocumentUploadRequestDto,
  DocumentUploadResponseDto,
  SubmitDocumentDto,
  SubmitDocumentResponseDto,
} from './kyc.dto';

@ApiTags('onboarding')
@ApiHeader({ name: 'Idempotency-Key', required: true })
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id')
export class DocumentsController {
  constructor(private readonly documents: DocumentService) {}

  @Post('document-uploads')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 10: authorise an expiring upload for one file',
  })
  @ApiResponse({ status: 200, type: DocumentUploadResponseDto })
  async authorise(
    @Param('application_id') applicationId: string,
    @Body() body: DocumentUploadRequestDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<DocumentUploadResponseDto> {
    const r = await this.documents.authoriseUpload({
      applicationId,
      customerId: p.id,
      requirementId: body.requirement_id,
      contentType: body.content_type,
      sizeBytes: body.size_bytes,
    });
    return {
      upload_id: r.uploadId,
      upload_url: r.uploadUrl,
      expires_in_seconds: r.expiresInSeconds,
    };
  }

  @Post('documents')
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 10: register uploaded files as a document; verification runs in the background',
  })
  @ApiResponse({ status: 202, type: SubmitDocumentResponseDto })
  async submit(
    @Param('application_id') applicationId: string,
    @Body() body: SubmitDocumentDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<SubmitDocumentResponseDto> {
    const r = await this.documents.submit({
      applicationId,
      customerId: p.id,
      requirementId: body.requirement_id,
      documentType: body.document_type,
      files: body.files.map((f) => ({ uploadId: f.upload_id, side: f.side })),
    });
    return {
      document_id: r.documentId,
      status: r.status,
      operation_id: r.operationId,
    };
  }
}
