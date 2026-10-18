import { Module } from '@nestjs/common';
import { EMAIL_SENDER } from '../../application/ports/email-sender.port';
import { SMS_SENDER } from '../../application/ports/sms-sender.port';
import { appConfig } from '../../common/config/app.config';
import { partnersConfig } from '../../common/config/partners.config';
import { LogSmsSender } from './log-sms.sender';
import { MessageSpy } from './message-spy';
import {
  createSmtpTransport,
  SMTP_TRANSPORT,
  SmtpEmailSender,
} from './smtp-email.sender';

/**
 * SMS: no provider is contracted yet, so the log sender is the only adapter. Email: SMTP (Mailpit locally).
 * MessageSpy is only provided outside production so SIT can read codes.
 */
@Module({
  providers: [
    {
      provide: MessageSpy,
      inject: [appConfig.KEY],
      useFactory: (cfg: ReturnType<typeof appConfig>) =>
        cfg.env === 'production' ? undefined : new MessageSpy(),
    },
    {
      provide: SMTP_TRANSPORT,
      inject: [partnersConfig.KEY],
      useFactory: (p: ReturnType<typeof partnersConfig>) =>
        createSmtpTransport(p.messaging),
    },
    { provide: SMS_SENDER, useClass: LogSmsSender },
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
  ],
  exports: [SMS_SENDER, EMAIL_SENDER, MessageSpy],
})
export class MessagingModule {}
