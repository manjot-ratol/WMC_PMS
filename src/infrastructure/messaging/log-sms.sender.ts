import { Injectable, Optional } from '@nestjs/common';
import type {
  OtpMessage,
  SendResult,
  SmsSenderPort,
} from '../../application/ports/sms-sender.port';
import { AppLogger } from '../../common/logging/logger.service';
import { maskPhone, type PhoneNumber } from '../../domain/shared/phone-number';
import { MessageSpy } from './message-spy';

/** Local/test SMS adapter: logs a masked destination (never the code) and records to the spy when present. */
@Injectable()
export class LogSmsSender implements SmsSenderPort {
  private readonly logger: AppLogger;

  constructor(
    logger: AppLogger,
    @Optional() private readonly spy?: MessageSpy,
  ) {
    this.logger = logger.child('LogSmsSender');
  }

  send(to: PhoneNumber, message: OtpMessage): Promise<SendResult> {
    this.logger.info('sms.sent', {
      to: maskPhone(to),
      template: message.template,
      expiresInMinutes: message.vars.expiresInMinutes,
    });
    this.spy?.record({ channel: 'SMS', to, otp: message.vars.otp });
    return Promise.resolve({
      accepted: true,
      providerRef: `log-${Date.now()}`,
    });
  }
}
