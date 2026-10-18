import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class AccountOpeningRunDto {
  @ApiProperty() @IsString() @Length(1, 60) snapshot_id!: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) document_pack_version!: number;
}
export class AccountOpeningRunResponseDto {
  @ApiProperty() run_id!: string;
  @ApiProperty({ example: 'QUEUED' }) status!: string;
}
export class UnderlyingAccountDto {
  @ApiProperty({
    description:
      'Unique per provider message; replays are acknowledged, never re-recorded',
  })
  @IsString()
  @Length(1, 120)
  provider_receipt_key!: string;
  @ApiProperty({ example: 'CUSTODIAN' })
  @IsString()
  @Length(1, 40)
  provider!: string;
  @ApiProperty({ example: 'PMS_ACCOUNT' })
  @IsString()
  @Length(1, 40)
  account_type!: string;
  @ApiProperty({ example: 'PMS000123' })
  @IsString()
  @Length(1, 80)
  account_reference!: string;
  @ApiProperty({ enum: ['PENDING', 'READY', 'REJECTED'] })
  @IsIn(['PENDING', 'READY', 'REJECTED'])
  status!: 'PENDING' | 'READY' | 'REJECTED';
}
export class UnderlyingAccountResponseDto {
  @ApiProperty() account_id!: string;
  @ApiProperty({ example: 'RECORDED' }) status!: string;
  @ApiProperty({ example: true }) accounts_ready!: boolean;
}
export class FundingReceiptDto {
  @ApiProperty() @IsString() @Length(1, 120) provider_receipt_key!: string;
  @ApiProperty({ example: 'BANK' })
  @IsString()
  @Length(1, 40)
  provider!: string;
  @ApiProperty({ example: 5000000 }) @IsNumber() @Min(0) amount_inr!: number;
  @ApiProperty({ example: 'INR' }) @IsString() @Length(3, 3) currency!: string;
  @ApiProperty({
    required: false,
    description: 'Remitter account number as reported by the provider',
  })
  @IsOptional()
  @IsString()
  @Length(6, 24)
  source_account_number?: string;
  @ApiProperty({ example: 'PMS-89ABCDEF' })
  @IsString()
  @Length(1, 64)
  destination_reference!: string;
  @ApiProperty({ example: '2026-10-18' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  value_date!: string;
}
export class FundingReceiptResponseDto {
  @ApiProperty() receipt_id!: string;
  @ApiProperty({ example: 'RECORDED', description: 'RECORDED | DUPLICATE' })
  status!: string;
  @ApiProperty({ example: 'MATCHED' }) match_status!: string;
  @ApiProperty({ example: 'RECONCILED' }) funding_status!: string;
}
