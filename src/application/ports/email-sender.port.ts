import type { EmailAddress } from '../../domain/shared/email-address';
import type { OtpMessage, SendResult } from './sms-sender.port';

export interface EmailSenderPort {
  send(to: EmailAddress, message: OtpMessage): Promise<SendResult>;
}
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
