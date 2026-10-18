import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';

export class CaseDto {
  @ApiProperty() case_id!: string;
  @ApiProperty() application_id!: string;
  @ApiProperty({ example: 'SCREENING_HIT' }) kind!: string;
  @ApiProperty({ example: 'HIGH' }) severity!: string;
  @ApiProperty({ example: 'OPEN' }) status!: string;
  @ApiProperty() source_run_id!: string;
  @ApiProperty({ required: false }) provider_case_id?: string;
  @ApiProperty({ type: Object }) summary!: Record<string, unknown>;
  @ApiProperty() created_at!: string;
}
export class ReviewTaskDto {
  @ApiProperty() task_id!: string;
  @ApiProperty() application_id!: string;
  @ApiProperty({ example: 'FUNDING_REVIEW' }) category!: string;
  @ApiProperty({ example: 'OPEN' }) status!: string;
  @ApiProperty({ example: false }) customer_visible!: boolean;
  @ApiProperty() created_at!: string;
}
export class DecisionDto {
  @ApiProperty({ enum: ['PROCEED', 'HOLD', 'REJECT'] })
  @IsIn(['PROCEED', 'HOLD', 'REJECT'])
  decision!: 'PROCEED' | 'HOLD' | 'REJECT';
  @ApiProperty({
    description:
      'Documented reason, at least 10 characters; kept in the restricted audit trail',
  })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}
export class DecisionResponseDto {
  @ApiProperty() case_id!: string;
  @ApiProperty({ example: 'CLOSED' }) case_status!: string;
  @ApiProperty() decision_id!: string;
}
export class BankEvidenceDto {
  @ApiProperty() @IsString() @Length(1, 60) verification_id!: string;
  @ApiProperty() @IsString() @Length(10, 1000) reason!: string;
}
export class BankEvidenceResponseDto {
  @ApiProperty() verification_id!: string;
  @ApiProperty({ example: 'VERIFIED' }) status!: string;
}
export class TaskResolutionDto {
  @ApiProperty({ enum: ['RESOLVED', 'REOPENED'] })
  @IsIn(['RESOLVED', 'REOPENED'])
  resolution!: 'RESOLVED' | 'REOPENED';
  @ApiProperty() @IsString() @Length(10, 1000) reason!: string;
}
export class TaskResolutionResponseDto {
  @ApiProperty() task_id!: string;
  @ApiProperty({ example: 'RESOLVED' }) status!: string;
}
