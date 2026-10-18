import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class SigningSessionDto {
  @ApiProperty({ example: 'snap_01' })
  @IsString()
  @Length(1, 60)
  snapshot_id!: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) document_pack_version!: number;
  @ApiProperty({ enum: ['AADHAAR_ESIGN'] })
  @IsIn(['AADHAAR_ESIGN'])
  signing_method!: 'AADHAAR_ESIGN';
}
class SdkLaunchDto {
  @ApiProperty({
    required: false,
    description:
      'Short-lived Digio SDK token; absent when an existing request is returned',
  })
  access_token?: string;
}
export class SigningSessionResponseDto {
  @ApiProperty() signing_session_id!: string;
  @ApiProperty({ example: 'REQUESTED' }) status!: string;
  @ApiProperty({ required: false }) provider_request_id?: string;
  @ApiProperty({ type: SdkLaunchDto }) sdk_launch!: SdkLaunchDto;
}
export class SigningSessionStatusDto {
  @ApiProperty({
    example: 'EXECUTED',
    description:
      'REQUESTED | IN_PROGRESS | EXECUTED | EXPIRED | FAILED | CANCELLED | SUPERSEDED',
  })
  status!: string;
  @ApiProperty({ example: 1 }) document_pack_version!: number;
  @ApiProperty({ example: true }) evidence_available!: boolean;
  @ApiProperty({ example: 'APPLICATION_PROCESSING' }) next_screen!: string;
}
class TaskDto {
  @ApiProperty() task_id!: string;
  @ApiProperty({ example: 'ACCOUNT_SETUP' }) category!: string;
  @ApiProperty({ example: 'IN_PROGRESS' }) status!: string;
}
export class ProcessingStatusDto {
  @ApiProperty({ example: 'PROCESSING' }) application_status!: string;
  @ApiProperty({ type: [TaskDto] }) tasks!: TaskDto[];
  @ApiProperty({ example: false }) customer_action_required!: boolean;
  @ApiProperty({ example: 'APPLICATION_PROCESSING' }) next_screen!: string;
}
export class TaskResponseDto {
  @ApiProperty({ enum: ['DOCUMENT', 'TEXT'] })
  @IsIn(['DOCUMENT', 'TEXT'])
  response_type!: 'DOCUMENT' | 'TEXT';
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  document_ids?: string[];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  text?: string;
}
export class TaskResponseResultDto {
  @ApiProperty({ example: 'SUBMITTED' }) status!: string;
  @ApiProperty({ example: 'UNDER_REVIEW' }) task_status!: string;
}
class BeneficiaryDto {
  @ApiProperty() account_name!: string;
  @ApiProperty({ example: '••••9012' }) account_number_masked!: string;
  @ApiProperty() ifsc!: string;
  @ApiProperty() bank_name!: string;
}
export class FundingInstructionsDto {
  @ApiProperty({ example: 'READY' }) status!: string;
  @ApiProperty({ example: 1 }) instructions_version!: number;
  @ApiProperty({ type: BeneficiaryDto }) beneficiary_details!: BeneficiaryDto;
  @ApiProperty({ example: 'PMS-89ABCDEF' }) payment_reference!: string;
  @ApiProperty({ example: 5000000 }) required_amount_inr!: number;
}
export class FundingNotificationDto {
  @ApiProperty({ example: 'BANK_TRANSFER' })
  @IsString()
  @Length(1, 40)
  funding_method!: string;
  @ApiProperty({ example: 'UTR123456789' })
  @IsString()
  @Length(4, 64)
  customer_transfer_reference!: string;
}
export class FundingNotificationResponseDto {
  @ApiProperty({ example: 'AWAITING_RECONCILIATION' }) status!: string;
  @ApiProperty() notification_id!: string;
  @ApiProperty({ example: 'FUNDING_STATUS' }) next_screen!: string;
}
export class FundingStatusDto {
  @ApiProperty({
    example: 'RECONCILED',
    description: 'AWAITING_FUNDS | PARTIAL | RECONCILED',
  })
  funding_status!: string;
  @ApiProperty({
    example: 'READY_FOR_ACTIVATION',
    description: 'NOT_READY | READY_FOR_ACTIVATION | BLOCKED | ACTIVE',
  })
  activation_status!: string;
  @ApiProperty({ example: false }) customer_action_required!: boolean;
  @ApiProperty({ example: 'ACTIVATION_PROGRESS' }) next_screen!: string;
}
export class CompletionDto {
  @ApiProperty({ example: 'ACTIVE' }) application_status!: string;
  @ApiProperty() pms_account_id!: string;
  @ApiProperty({ example: true }) onboarding_complete!: boolean;
  @ApiProperty({ example: 'NOT_STARTED' }) first_investment_status!: string;
  @ApiProperty({ example: 'PORTFOLIO' }) next_screen!: string;
}
