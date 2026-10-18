import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmailVerificationService } from '../../../application/onboarding/email-verification.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  CreateEmailChallengeDto,
  EmailChallengeResentResponseDto,
  EmailChallengeResponseDto,
  EmailVerifiedResponseDto,
  VerifyEmailOtpDto,
} from './onboarding.dto';

@ApiTags('onboarding')
@ApiHeader({ name: 'Idempotency-Key', required: true })
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id/email/challenges')
export class EmailChallengeController {
  constructor(private readonly service: EmailVerificationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @ApiOperation({ summary: 'Screen 03: start email verification' })
  @ApiResponse({ status: 202, type: EmailChallengeResponseDto })
  async create(
    @Param('application_id') applicationId: string,
    @Body() body: CreateEmailChallengeDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<EmailChallengeResponseDto> {
    const r = await this.service.create({
      applicationId,
      customerId: p.id,
      email: body.email,
    });
    return {
      challenge_id: r.challengeId,
      status: r.status,
      email_masked: r.emailMasked,
      expires_in_seconds: r.expiresInSeconds,
    };
  }

  @Post(':challenge_id/verify')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Screen 04: verify email OTP' })
  @ApiResponse({ status: 200, type: EmailVerifiedResponseDto })
  async verify(
    @Param('application_id') applicationId: string,
    @Param('challenge_id') challengeId: string,
    @Body() body: VerifyEmailOtpDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<EmailVerifiedResponseDto> {
    const r = await this.service.verify({
      applicationId,
      customerId: p.id,
      challengeId,
      otp: body.otp,
    });
    return { status: r.status, next_screen: r.nextScreen };
  }

  @Post(':challenge_id/resend')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Screen 04: resend email OTP (new challenge id)' })
  @ApiResponse({ status: 200, type: EmailChallengeResentResponseDto })
  async resend(
    @Param('application_id') applicationId: string,
    @Param('challenge_id') challengeId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<EmailChallengeResentResponseDto> {
    const r = await this.service.resend({
      applicationId,
      customerId: p.id,
      challengeId,
    });
    return { challenge_id: r.challengeId, status: r.status };
  }
}
