import { Controller, Get, Inject, Optional, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UseInternal } from '../../common/auth/auth.decorators';
import { appConfig } from '../../common/config/app.config';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { MessageSpy } from '../../infrastructure/messaging/message-spy';
import { ApiErrorDto } from '../shared/api-error.dto';

/**
 * Local/test only: OTPs are never logged, so manual testers read the last one delivered to a phone or email here.
 * The spy provider is absent in production, which makes this endpoint 404 there even with the service token.
 */
@ApiTags('internal-dev')
@ApiHeader({ name: 'X-Internal-Token', required: true })
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 404, type: ApiErrorDto })
@UseInternal()
@Controller('internal/v1/dev')
export class DevOtpController {
  constructor(
    @Inject(appConfig.KEY) private readonly cfg: ReturnType<typeof appConfig>,
    @Optional() private readonly spy?: MessageSpy,
  ) {}

  @Get('otps')
  @ApiOperation({
    summary: 'Last OTP sent to a phone (+91…) or email. Non-production only.',
  })
  @ApiQuery({
    name: 'to',
    description: 'E.164 phone such as +919876543210, or the email address',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        to: '+919876543210',
        channel: 'SMS',
        otp: '123456',
        sent_at: '2026-10-18T10:00:00.000Z',
      },
    },
  })
  lastOtp(@Query('to') to?: string): {
    to: string;
    channel: string;
    otp: string;
    sent_at: string;
  } {
    if (this.cfg.env === 'production' || !this.spy) throw new NotFoundError();
    if (!to) throw new ValidationError(undefined, { details: { field: 'to' } });
    const target = /^\d{10}$/.test(to) ? `+91${to}` : to;
    const m = this.spy.lastFor(target);
    if (!m) throw new NotFoundError();
    return {
      to: target,
      channel: m.channel,
      otp: m.otp,
      sent_at: m.at.toISOString(),
    };
  }
}
