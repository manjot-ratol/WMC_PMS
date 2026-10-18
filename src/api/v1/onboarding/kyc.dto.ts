import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class IdentityVerificationDto {
  @ApiProperty({ example: 'ABCPE1234F' })
  @IsString()
  @Length(10, 10)
  pan!: string;
  @ApiProperty({ example: 'Vinod Kumar Singh' })
  @IsString()
  @Length(2, 100)
  legal_name!: string;
  @ApiProperty({ example: '1990-01-15', description: 'ISO date YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date_of_birth!: string;
  @ApiProperty({ example: 'kyc_fetch_v1' })
  @IsString()
  @Length(1, 64)
  permission_version!: string;
}
export class IdentityVerificationResponseDto {
  @ApiProperty({ example: 'op_...' }) operation_id!: string;
  @ApiProperty({ example: 'PROCESSING' }) status!: string;
  @ApiProperty({ example: 'KYC_PROGRESS' }) next_screen!: string;
}

class KycAddressDto {
  @ApiProperty({ required: false }) line1?: string;
  @ApiProperty({ required: false }) line2?: string;
  @ApiProperty({ required: false }) line3?: string;
  @ApiProperty({ required: false }) city?: string;
  @ApiProperty({ required: false }) pin_code?: string;
}
class KycDetailsDto {
  @ApiProperty({ required: false }) legal_name?: string;
  @ApiProperty({ required: false, type: KycAddressDto })
  address?: KycAddressDto;
}
export class KycStatusResponseDto {
  @ApiProperty({
    example: 'EXISTING_RECORD_AVAILABLE',
    description:
      'PROCESSING | EXISTING_RECORD_AVAILABLE | NO_RECORD | REVIEW_REQUIRED | TECHNICAL_ERROR | COMPLETE',
  })
  status!: string;
  @ApiProperty({
    example: 'REUSE',
    required: false,
    description: 'REUSE | REMEDIATE | FRESH | ASSISTED',
  })
  route?: string;
  @ApiProperty({ example: 'op_...' }) operation_id!: string;
  @ApiProperty({
    example: 1,
    description: 'Pass back as kyc_record_version on confirmation',
  })
  kyc_record_version!: number;
  @ApiProperty({ example: 'CONFIRM_KYC' }) next_screen!: string;
  @ApiProperty({
    required: false,
    type: KycDetailsDto,
    description: 'Prefill shown on screen 08 when a reusable record exists',
  })
  details?: KycDetailsDto;
}

export class KycConfirmationDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) kyc_record_version!: number;
  @ApiProperty({ example: true }) @IsBoolean() details_confirmed!: boolean;
  @ApiProperty({
    example: {},
    description:
      'Fields the customer asked to correct; non-empty routes to fresh KYC',
  })
  @IsObject()
  changes!: Record<string, unknown>;
}
export class KycConfirmationResponseDto {
  @ApiProperty({
    example: 'CONFIRMED',
    description: 'CONFIRMED | REMEDIATION_REQUIRED',
  })
  status!: string;
  @ApiProperty({ example: 'COMPLETE' }) kyc_status!: string;
  @ApiProperty({ example: 'PROFILE' }) next_screen!: string;
}

export class KycSessionDto {
  @ApiProperty({ enum: ['DIGITAL_DOCUMENTS'] })
  @IsIn(['DIGITAL_DOCUMENTS'])
  method!: 'DIGITAL_DOCUMENTS';
  @ApiProperty({ example: 'KYC_RETURN', required: false })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  return_route?: string;
}
class SdkLaunchDto {
  @ApiProperty({
    description: 'Short-lived DigiStudio SDK token. Never log or track it.',
  })
  access_token!: string;
}
export class KycSessionResponseDto {
  @ApiProperty() session_id!: string;
  @ApiProperty({ example: 'REQUESTED' }) status!: string;
  @ApiProperty({ example: 'DIGIO' }) provider!: string;
  @ApiProperty({ required: false }) provider_request_id?: string;
  @ApiProperty({ type: SdkLaunchDto }) sdk_launch!: SdkLaunchDto;
  @ApiProperty({ example: 'PROVIDER_KYC' }) next_screen!: string;
}

export class DocumentUploadRequestDto {
  @ApiProperty({ example: 'ADDRESS_PROOF' })
  @IsString()
  @Length(1, 64)
  requirement_id!: string;
  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @Length(1, 64)
  content_type!: string;
  @ApiProperty({ example: 150000 }) @IsInt() @Min(1) size_bytes!: number;
}
export class DocumentUploadResponseDto {
  @ApiProperty() upload_id!: string;
  @ApiProperty({
    description:
      'Expiring PUT URL; send the bytes with the declared Content-Type',
  })
  upload_url!: string;
  @ApiProperty({ example: 300 }) expires_in_seconds!: number;
}
class DocumentFileDto {
  @ApiProperty({ example: 'upl_...' })
  @IsString()
  @Length(1, 64)
  upload_id!: string;
  @ApiProperty({ example: 'PHOTO_PAGE' })
  @IsString()
  @Length(1, 32)
  side!: string;
}
export class SubmitDocumentDto {
  @ApiProperty({ example: 'ADDRESS_PROOF' })
  @IsString()
  @Length(1, 64)
  requirement_id!: string;
  @ApiProperty({ example: 'PASSPORT' })
  @IsString()
  @Length(1, 64)
  document_type!: string;
  @ApiProperty({ type: [DocumentFileDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentFileDto)
  files!: DocumentFileDto[];
}
export class SubmitDocumentResponseDto {
  @ApiProperty() document_id!: string;
  @ApiProperty({ example: 'PROCESSING' }) status!: string;
  @ApiProperty() operation_id!: string;
}

export class AdditionalVerificationDto {
  @ApiProperty({ enum: ['SELFIE_LIVENESS', 'ASSISTED_IPV'] })
  @IsIn(['SELFIE_LIVENESS', 'ASSISTED_IPV'])
  verification_type!: 'SELFIE_LIVENESS' | 'ASSISTED_IPV';
  @ApiProperty({
    required: false,
    example: 'doc_...',
    description: 'A VERIFIED document under requirement SELFIE',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  selfie_document_id?: string;
}
export class AdditionalVerificationResponseDto {
  @ApiProperty() verification_id!: string;
  @ApiProperty({
    example: 'REQUESTED',
    description: 'REQUESTED | EXEMPT | REVIEW_REQUIRED',
  })
  status!: string;
  @ApiProperty({ required: false }) provider_session_id?: string;
  @ApiProperty({ example: 'IPV' }) next_screen!: string;
}
