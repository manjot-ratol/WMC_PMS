import { Inject, Injectable, Optional } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailSenderPort } from '../../application/ports/email-sender.port';
import type {
  OtpMessage,
  SendResult,
} from '../../application/ports/sms-sender.port';
import { partnersConfig } from '../../common/config/partners.config';
import { AppLogger } from '../../common/logging/logger.service';
import {
  maskEmail,
  type EmailAddress,
} from '../../domain/shared/email-address';
import { MessageSpy } from './message-spy';

export const SMTP_TRANSPORT = Symbol('SMTP_TRANSPORT');

export function createSmtpTransport(
  cfg: ReturnType<typeof partnersConfig>['messaging'],
): Transporter {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: false,
    connectionTimeout: cfg.timeoutMs,
  });
}

/** SMTP adapter (Mailpit locally). Logs a masked destination, never the code. */
@Injectable()
export class SmtpEmailSender implements EmailSenderPort {
  private readonly logger: AppLogger;

  constructor(
    logger: AppLogger,
    @Inject(SMTP_TRANSPORT)
    private readonly transport: Pick<Transporter, 'sendMail'>,
    @Inject(partnersConfig.KEY)
    private readonly cfg: ReturnType<typeof partnersConfig>,
    @Optional() private readonly spy?: MessageSpy,
  ) {
    this.logger = logger.child('SmtpEmailSender');
  }

  async send(to: EmailAddress, message: OtpMessage): Promise<SendResult> {
    try {
      const info = (await this.transport.sendMail({
        from: this.cfg.messaging.from,
        to,
        subject: 'Your verification code',
        text: `Your verification code is ${message.vars.otp}. It expires in ${message.vars.expiresInMinutes} minutes. Do not share it with anyone.`,
      })) as { messageId?: string };
      this.logger.info('email.sent', {
        to: maskEmail(to),
        template: message.template,
      });
      this.spy?.record({ channel: 'EMAIL', to, otp: message.vars.otp });
      return { accepted: true, providerRef: info.messageId };
    } catch (err) {
      this.logger.warn('email.failed', { to: maskEmail(to), err });
      return { accepted: false };
    }
  }
}
