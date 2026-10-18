import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdditionalVerificationService } from '../../../application/kyc/additional-verification.service';
import { IdentityService } from '../../../application/kyc/identity.service';
import { KycConfirmationService } from '../../../application/kyc/kyc-confirmation.service';
import { KycQueryService } from '../../../application/kyc/kyc-query.service';
import { KycSessionService } from '../../../application/kyc/kyc-session.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  AdditionalVerificationDto,
  AdditionalVerificationResponseDto,
  IdentityVerificationDto,
  IdentityVerificationResponseDto,
  KycConfirmationDto,
  KycConfirmationResponseDto,
  KycSessionDto,
  KycSessionResponseDto,
  KycStatusResponseDto,
} from './kyc.dto';

@ApiTags('onboarding')
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'Required on POST/PUT',
})
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id')
export class KycController {
  constructor(
    private readonly identity: IdentityService,
    private readonly query: KycQueryService,
    private readonly confirmation: KycConfirmationService,
    private readonly sessions: KycSessionService,
    private readonly verifications: AdditionalVerificationService,
  ) {}

  @Post('identity-verifications')
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 06: submit PAN, legal name and date of birth; starts the KRA lookup',
  })
  @ApiResponse({ status: 202, type: IdentityVerificationResponseDto })
  async submitIdentity(
    @Param('application_id') applicationId: string,
    @Body() body: IdentityVerificationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<IdentityVerificationResponseDto> {
    const r = await this.identity.submit({
      applicationId,
      customerId: p.id,
      pan: body.pan,
      legalName: body.legal_name,
      dateOfBirth: body.date_of_birth,
      permissionVersion: body.permission_version,
    });
    return {
      operation_id: r.operationId,
      status: r.status,
      next_screen: r.nextScreen,
    };
  }

  @Get('kyc')
  @ApiOperation({
    summary:
      'Screen 07: KYC lookup status (read-only; never triggers a provider call)',
  })
  @ApiResponse({ status: 200, type: KycStatusResponseDto })
  async kyc(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<KycStatusResponseDto> {
    const v = await this.query.get(applicationId, p.id);
    return {
      status: v.status,
      route: v.route,
      operation_id: v.operationId,
      kyc_record_version: v.recordVersion,
      next_screen: v.nextScreen,
      details: v.details
        ? {
            legal_name: v.details.legalName,
            address: v.details.address
              ? {
                  line1: v.details.address.line1,
                  line2: v.details.address.line2,
                  line3: v.details.address.line3,
                  city: v.details.address.city,
                  pin_code: v.details.address.pinCode,
                }
              : undefined,
          }
        : undefined,
    };
  }

  @Put('kyc/confirmation')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 08: confirm a reusable KYC record or request corrections',
  })
  @ApiResponse({ status: 200, type: KycConfirmationResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async confirm(
    @Param('application_id') applicationId: string,
    @Body() body: KycConfirmationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<KycConfirmationResponseDto> {
    const r = await this.confirmation.confirm({
      applicationId,
      customerId: p.id,
      kycRecordVersion: body.kyc_record_version,
      detailsConfirmed: body.details_confirmed,
      changes: body.changes,
    });
    return {
      status: r.status,
      kyc_status: r.kycStatus,
      next_screen: r.nextScreen,
    };
  }

  @Post('kyc/sessions')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 09: start (or resume) a fresh digital KYC session with Digio',
  })
  @ApiResponse({ status: 201, type: KycSessionResponseDto })
  @ApiResponse({ status: 503, type: ApiErrorDto })
  async createSession(
    @Param('application_id') applicationId: string,
    @Body() body: KycSessionDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<KycSessionResponseDto> {
    const r = await this.sessions.create({
      applicationId,
      customerId: p.id,
      method: body.method,
      returnRoute: body.return_route,
    });
    return {
      session_id: r.sessionId,
      status: r.status,
      provider: r.provider,
      provider_request_id: r.providerRequestId,
      sdk_launch: { access_token: r.sdkLaunch.accessToken },
      next_screen: r.nextScreen,
    };
  }

  @Post('kyc/additional-verifications')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 11: selfie liveness/face-match IPV, or request assisted verification',
  })
  @ApiResponse({ status: 201, type: AdditionalVerificationResponseDto })
  async additionalVerification(
    @Param('application_id') applicationId: string,
    @Body() body: AdditionalVerificationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<AdditionalVerificationResponseDto> {
    const r = await this.verifications.request({
      applicationId,
      customerId: p.id,
      verificationType: body.verification_type,
      selfieDocumentId: body.selfie_document_id,
    });
    return {
      verification_id: r.verificationId,
      status: r.status,
      provider_session_id: r.providerSessionId,
      next_screen: r.nextScreen,
    };
  }
}
