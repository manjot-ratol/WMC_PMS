import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProfileDto {
  @ApiProperty({ example: 'PRIVATE_SECTOR' })
  @IsString()
  @Length(1, 40)
  occupation!: string;
  @ApiProperty({ example: 'INR_10L_25L' })
  @IsString()
  @Length(1, 40)
  annual_income_band!: string;
  @ApiProperty({ example: ['SALARY'], type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  source_of_funds!: string[];
  @ApiProperty({
    required: false,
    description: 'Required for OTHER, INHERITANCE and GIFT',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  source_of_funds_explanation?: string;
  @ApiProperty({
    example: 0,
    description: 'Last seen profile version; 0 before the first save',
  })
  @IsInt()
  @Min(0)
  profile_version!: number;
}
export class ProfileResponseDto {
  @ApiProperty({ example: 'COMPLETE' }) status!: string;
  @ApiProperty({ example: 1 }) profile_version!: number;
  @ApiProperty({ example: 'TAX_DECLARATIONS' }) next_screen!: string;
}

class TaxResidencyDto {
  @ApiProperty({ example: 'IN' }) @IsString() @Length(2, 2) country!: string;
  @ApiProperty({ required: false, nullable: true, example: 'ABCPE1234F' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  tin?: string | null;
  @ApiProperty({ required: false, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  tin_unavailable_reason?: string | null;
}
export class DeclarationsDto {
  @ApiProperty({ type: [TaxResidencyDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => TaxResidencyDto)
  tax_residencies!: TaxResidencyDto[];
  @ApiProperty({ enum: ['NOT_PEP', 'PEP', 'RELATED_TO_PEP'] })
  @IsIn(['NOT_PEP', 'PEP', 'RELATED_TO_PEP'])
  pep_declaration!: string;
  @ApiProperty({ example: 'declarations_v1' })
  @IsString()
  @Length(1, 40)
  declaration_version!: string;
}
export class DeclarationsResponseDto {
  @ApiProperty({ example: 'COMPLETE' }) status!: string;
  @ApiProperty({ example: false }) additional_information_required!: boolean;
  @ApiProperty({ example: 'BANK_DETAILS' }) next_screen!: string;
}

export class BankVerificationDto {
  @ApiProperty({ example: '999912345678' })
  @IsString()
  @Length(6, 24)
  account_number!: string;
  @ApiProperty({ example: '999912345678' })
  @IsString()
  @Length(6, 24)
  account_number_confirmation!: string;
  @ApiProperty({ example: 'HDFC0001234' })
  @IsString()
  @Length(11, 11)
  ifsc!: string;
  @ApiProperty({ example: 'Vinod Kumar Singh' })
  @IsString()
  @Length(2, 100)
  holder_name!: string;
}
export class BankVerificationStartedDto {
  @ApiProperty() verification_id!: string;
  @ApiProperty({ example: 'PROCESSING' }) status!: string;
  @ApiProperty({ example: 'BANK_PROGRESS' }) next_screen!: string;
}
export class BankVerificationStatusDto {
  @ApiProperty({
    example: 'VERIFIED',
    description:
      'PROCESSING | VERIFIED | ACTION_REQUIRED | REVIEW_REQUIRED | TECHNICAL_ERROR',
  })
  status!: string;
  @ApiProperty({ example: '••••5678' }) account_masked!: string;
  @ApiProperty({
    example: [],
    type: [String],
    description: 'CORRECT_DETAILS | UPLOAD_BANK_PROOF',
  })
  required_actions!: string[];
  @ApiProperty({ example: 'NOMINATION' }) next_screen!: string;
}

class GuardianDto {
  @ApiProperty() @IsString() @Length(2, 100) full_name!: string;
  @ApiProperty({ example: 'MOTHER' })
  @IsString()
  @Length(1, 20)
  relationship!: string;
}
class NomineeDto {
  @ApiProperty() @IsString() @Length(2, 100) full_name!: string;
  @ApiProperty({ example: 'SPOUSE' })
  @IsString()
  @Length(1, 20)
  relationship!: string;
  @ApiProperty({ example: false }) @IsBoolean() is_minor!: boolean;
  @ApiProperty({ required: false, example: '2015-05-05' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date_of_birth?: string;
  @ApiProperty({ required: false, example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  allocation_percent?: number;
  @ApiProperty({ required: false, type: GuardianDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GuardianDto)
  guardian?: GuardianDto;
}
export class NominationDto {
  @ApiProperty({ enum: ['NOMINATE', 'OPT_OUT'] })
  @IsIn(['NOMINATE', 'OPT_OUT'])
  choice!: 'NOMINATE' | 'OPT_OUT';
  @ApiProperty({ enum: ['EQUAL', 'CUSTOM'], required: false })
  @IsOptional()
  @IsIn(['EQUAL', 'CUSTOM'])
  allocation_mode?: 'EQUAL' | 'CUSTOM';
  @ApiProperty({ type: [NomineeDto] })
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => NomineeDto)
  nominees!: NomineeDto[];
}
export class NominationResponseDto {
  @ApiProperty({ example: 'CAPTURED' }) status!: string;
  @ApiProperty({ example: 'NOT_SUBMITTED' }) registration_status!: string;
  @ApiProperty({ example: 1 }) nomination_version!: number;
  @ApiProperty({ example: 'INVESTMENT_PROFILE' }) next_screen!: string;
}
