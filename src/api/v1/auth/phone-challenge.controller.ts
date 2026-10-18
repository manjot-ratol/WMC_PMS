import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PhoneChallengeService } from '../../../application/auth/phone-challenge.service';
import { UsePreAuth } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import { ClientIp } from '../../shared/client-ip.decorator';
import { BearerTokenValue } from '../../shared/session-token.decorator';
import {
  CreatePhoneChallengeDto,
  PhoneChallengeResentResponseDto,
  PhoneChallengeResponseDto,
  PhoneVerifiedResponseDto,
  VerifyOtpDto,
} from './phone-challenge.dto';

@ApiTags('auth')
@ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description:
    'Unique per logical request; replays return the stored response.',
})
@ApiResponse({ status: 422, type: ApiErrorDto })
@ApiResponse({ status: 429, type: ApiErrorDto })
@Controller('v1/auth/phone/challenges')
export class PhoneChallengeController {
  constructor(private readonly service: PhoneChallengeService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @ApiOperation({ summary: 'Screen 01: start phone verification' })
  @ApiResponse({ status: 202, type: PhoneChallengeResponseDto })
  async create(
    @Body() body: CreatePhoneChallengeDto,
    @ClientIp() ip: string,
  ): Promise<PhoneChallengeResponseDto> {
    const r = await this.service.create({
      phone: body.phone,
      purpose: body.purpose,
      privacyNoticeVersion: body.privacy_notice_version,
      clientIp: ip,
    });
    return {
      challenge_id: r.challengeId,
      status: r.status,
      expires_in_seconds: r.expiresInSeconds,
      resend_after_seconds: r.resendAfterSeconds,
      phone_masked: r.phoneMasked,
      preauth_token: r.preauthToken,
    };
  }

  @Post(':challenge_id/verify')
  @HttpCode(HttpStatus.OK)
  @UsePreAuth()
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 02: verify phone OTP, create or resume the application, issue a session',
  })
  @ApiResponse({ status: 200, type: PhoneVerifiedResponseDto })
  async verify(
    @Param('challenge_id') challengeId: string,
    @Body() body: VerifyOtpDto,
    @CurrentPrincipal() principal: Principal,
    @BearerTokenValue() token: string,
  ): Promise<PhoneVerifiedResponseDto> {
    const r = await this.service.verify({
      challengeId,
      otp: body.otp,
      principalFingerprint: principal.id,
      preauthToken: token,
    });
    return {
      status: r.status,
      customer_id: r.customerId,
      application_id: r.applicationId,
      next_screen: r.nextScreen,
      session_token: r.sessionToken,
    };
  }

  @Post(':challenge_id/resend')
  @HttpCode(HttpStatus.OK)
  @UsePreAuth()
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 02: resend the phone OTP (new challenge id)',
  })
  @ApiResponse({ status: 200, type: PhoneChallengeResentResponseDto })
  async resend(
    @Param('challenge_id') challengeId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<PhoneChallengeResentResponseDto> {
    const r = await this.service.resend({
      challengeId,
      principalFingerprint: principal.id,
    });
    return {
      challenge_id: r.challengeId,
      status: r.status,
      expires_in_seconds: r.expiresInSeconds,
      resend_after_seconds: r.resendAfterSeconds,
    };
  }
}
