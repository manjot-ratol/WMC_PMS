import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

class AnswerDto {
  @ApiProperty({ example: 'OBJECTIVE' })
  @IsString()
  @Length(1, 40)
  question_id!: string;
  @ApiProperty({ example: 'LONG_TERM_GROWTH' })
  @IsString()
  @Length(1, 40)
  answer_id!: string;
}
export class SuitabilityAssessmentDto {
  @ApiProperty({ example: 'suitability_v1' })
  @IsString()
  @Length(1, 40)
  questionnaire_version!: string;
  @ApiProperty({
    type: [AnswerDto],
    description:
      'Scores are computed server-side; none are accepted from the client',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}
export class SuitabilityAssessmentResponseDto {
  @ApiProperty() assessment_id!: string;
  @ApiProperty({ example: 'INCOMPLETE', description: 'COMPLETE | INCOMPLETE' })
  status!: string;
  @ApiProperty({
    type: [String],
    example: ['LIQUIDITY', 'EXPERIENCE', 'RISK_CAPACITY'],
  })
  missing_question_ids!: string[];
  @ApiProperty({ example: 'INVESTMENT_PROFILE' }) next_screen!: string;
}

export class InvestmentApproachDto {
  @ApiProperty() @IsString() @Length(1, 60) assessment_id!: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) assessment_version!: number;
  @ApiProperty({ example: 'EQUITY_GROWTH' })
  @IsString()
  @Length(1, 40)
  approach_code!: string;
  @ApiProperty({ example: true }) @IsBoolean() confirmed!: boolean;
}
export class InvestmentApproachResponseDto {
  @ApiProperty({ example: 'CONFIRMED' }) status!: string;
  @ApiProperty({ example: 1 }) approach_version!: number;
  @ApiProperty({ example: 'FEES_DISCLOSURES' }) next_screen!: string;
}

export class FeeIllustrationDto {
  @ApiProperty({ example: 'EQUITY_GROWTH' })
  @IsString()
  @Length(1, 40)
  approach_code!: string;
  @ApiProperty({ example: 'fees_v1' })
  @IsString()
  @Length(1, 40)
  fee_schedule_version!: string;
  @ApiProperty({ example: 'RETURN_PLUS_10' })
  @IsString()
  @Length(1, 40)
  scenario_code!: string;
}
class FeeLineItemDto {
  @ApiProperty({ example: 'MANAGEMENT_FEE' }) code!: string;
  @ApiProperty({ example: 100000 }) amount_inr!: number;
}
export class FeeIllustrationResponseDto {
  @ApiProperty({ example: 'CALCULATED' }) status!: string;
  @ApiProperty() illustration_id!: string;
  @ApiProperty({ type: [FeeLineItemDto] }) line_items!: FeeLineItemDto[];
  @ApiProperty({ example: 'illustration_v1' }) disclaimer_version!: string;
}

class AcknowledgementItemDto {
  @ApiProperty({ example: 'DISCLOSURE' })
  @IsString()
  @Length(1, 40)
  document_type!: string;
  @ApiProperty({ example: 'disclosure_v1' })
  @IsString()
  @Length(1, 40)
  document_version!: string;
  @ApiProperty({ example: true }) @IsBoolean() acknowledged!: boolean;
}
export class AcknowledgementsDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) document_pack_version!: number;
  @ApiProperty({ type: [AcknowledgementItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AcknowledgementItemDto)
  acknowledgements!: AcknowledgementItemDto[];
  @ApiProperty({ description: 'Customer-typed statement; never prefilled' })
  @IsString()
  @Length(1, 1000)
  fee_understanding_note!: string;
}
export class AcknowledgementsResponseDto {
  @ApiProperty({ example: 'RECORDED' }) status!: string;
  @ApiProperty({ example: true }) fee_annexure_execution_required!: boolean;
  @ApiProperty({ example: 'APPLICATION_REVIEW' }) next_screen!: string;
}

export class ReviewSummaryDto {
  @ApiProperty({ example: 12 }) application_version!: number;
  @ApiProperty({ example: 1 }) document_pack_version!: number;
  @ApiProperty({ example: true }) ready!: boolean;
  @ApiProperty({ type: [String], example: [] }) blockers!: string[];
  @ApiProperty({
    type: Object,
    description: 'Masked per-section summary with versions',
  })
  sections!: Record<string, unknown>;
}
export class ReviewConfirmationDto {
  @ApiProperty({ example: 12 }) @IsInt() @Min(0) application_version!: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) document_pack_version!: number;
  @ApiProperty({ example: true }) @IsBoolean() details_confirmed!: boolean;
}
export class ReviewConfirmationResponseDto {
  @ApiProperty({ example: 'CONFIRMED' }) status!: string;
  @ApiProperty() snapshot_id!: string;
  @ApiProperty({ example: 'SIGN_DOCUMENTS' }) next_screen!: string;
}
