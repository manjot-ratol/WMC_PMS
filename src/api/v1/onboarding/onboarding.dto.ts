import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Length, Matches, Min } from 'class-validator';
import {
  CUSTOMER_TYPES,
  DISTRIBUTION_ROUTES,
  RESIDENTIAL_STATUSES,
} from '../../../domain/eligibility/eligibility-engine';

export class CreateEmailChallengeDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsString()
  @Length(3, 254)
  email!: string;
}
export class EmailChallengeResponseDto {
  @ApiProperty() challenge_id!: string;
  @ApiProperty({ example: 'DISPATCHED' }) status!: string;
  @ApiProperty({ example: 'c***@example.com' }) email_masked!: string;
  @ApiProperty({ example: 300 }) expires_in_seconds!: number;
}
export class VerifyEmailOtpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}
export class EmailVerifiedResponseDto {
  @ApiProperty({ example: 'VERIFIED' }) status!: 'VERIFIED';
  @ApiProperty({ example: 'ELIGIBILITY' }) next_screen!: string;
}
export class EmailChallengeResentResponseDto {
  @ApiProperty() challenge_id!: string;
  @ApiProperty() status!: string;
}

export class EligibilityDto {
  @ApiProperty({ enum: CUSTOMER_TYPES })
  @IsIn(CUSTOMER_TYPES)
  customer_type!: (typeof CUSTOMER_TYPES)[number];
  @ApiProperty({ enum: RESIDENTIAL_STATUSES })
  @IsIn(RESIDENTIAL_STATUSES)
  residential_status!: (typeof RESIDENTIAL_STATUSES)[number];
  @ApiProperty({
    example: 5000000,
    description: 'Intended investment in INR (whole rupees).',
  })
  @IsInt()
  @Min(1)
  intended_investment_inr!: number;
  @ApiProperty({ enum: DISTRIBUTION_ROUTES })
  @IsIn(DISTRIBUTION_ROUTES)
  distribution_route!: (typeof DISTRIBUTION_ROUTES)[number];
}
export class EligibilityResponseDto {
  @ApiProperty({
    example: 'ELIGIBLE',
    description: 'ELIGIBLE | ASSISTED_REQUIRED | NOT_ELIGIBLE',
  })
  status!: string;
  @ApiProperty({ example: 'eligibility_v1' }) ruleset_version!: string;
  @ApiProperty({ example: 'RESIDENT_SINGLE_HOLDER', required: false })
  journey_route?: string;
  @ApiProperty({ example: 'PAN_IDENTITY' }) next_screen!: string;
}

class ApplicationStepDto {
  @ApiProperty({ example: 'PHONE_VERIFIED' }) step_id!: string;
  @ApiProperty({ example: 'COMPLETE' }) status!: string;
  @ApiProperty({ required: false }) completed_at?: string;
}
export class ApplicationSummaryDto {
  @ApiProperty() application_id!: string;
  @ApiProperty({ example: 'IN_PROGRESS' }) status!: string;
  @ApiProperty({ example: 'EMAIL_ENTRY' }) next_screen!: string;
  @ApiProperty({ example: 3 }) version!: number;
  @ApiProperty({ example: 'pms_v3' }) journey_version!: string;
  @ApiProperty({ type: [ApplicationStepDto] }) steps!: ApplicationStepDto[];
}
