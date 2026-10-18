import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length, Matches } from 'class-validator';

export class CreatePhoneChallengeDto {
  @ApiProperty({
    example: '+919000000001',
    description: 'Indian mobile number; +91 prefix optional.',
  })
  @IsString()
  @Length(10, 16)
  phone!: string;

  @ApiProperty({ enum: ['PMS_ONBOARDING'], example: 'PMS_ONBOARDING' })
  @IsIn(['PMS_ONBOARDING'])
  purpose!: 'PMS_ONBOARDING';

  @ApiProperty({ example: 'privacy_v1' })
  @IsString()
  @Length(1, 64)
  privacy_notice_version!: string;
}

export class PhoneChallengeResponseDto {
  @ApiProperty({ example: 'ch_8f3kX2...' }) challenge_id!: string;
  @ApiProperty({
    example: 'DISPATCH_PENDING',
    description: 'DISPATCH_PENDING | DISPATCHED | DISPATCH_FAILED',
  })
  status!: string;
  @ApiProperty({ example: 300 }) expires_in_seconds!: number;
  @ApiProperty({ example: 30 }) resend_after_seconds!: number;
  @ApiProperty({ example: '+91 ******0001' }) phone_masked!: string;
  @ApiProperty({
    description:
      'Short-lived credential for verify/resend only. Never a customer session.',
  })
  preauth_token!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}

export class PhoneVerifiedResponseDto {
  @ApiProperty({ example: 'VERIFIED' }) status!: 'VERIFIED';
  @ApiProperty({ example: 'cus_...' }) customer_id!: string;
  @ApiProperty({ example: 'app_...' }) application_id!: string;
  @ApiProperty({ example: 'EMAIL_ENTRY' }) next_screen!: string;
  @ApiProperty({
    description:
      'Customer session bearer token (mobile). Web clients receive it as an HttpOnly cookie in a later phase.',
  })
  session_token!: string;
}

export class PhoneChallengeResentResponseDto {
  @ApiProperty() challenge_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() expires_in_seconds!: number;
  @ApiProperty() resend_after_seconds!: number;
}
