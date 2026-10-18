import type { PhoneNumber } from '../../domain/shared/phone-number';

export interface OtpMessage {
  template: 'OTP';
  vars: { otp: string; expiresInMinutes: number };
}

export interface SendResult {
  accepted: boolean;
  providerRef?: string;
}

/** Sends an OTP SMS. Implementations must never log the OTP. */
export interface SmsSenderPort {
  send(to: PhoneNumber, message: OtpMessage): Promise<SendResult>;
}
export const SMS_SENDER = Symbol('SMS_SENDER');
