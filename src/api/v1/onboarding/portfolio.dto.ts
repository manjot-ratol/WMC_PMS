import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

export class PortfolioImportDto {
  @ApiProperty({
    example: true,
    description:
      'Customer consents to fetching their mutual-fund holdings (CAS) from MF Central',
  })
  @IsBoolean()
  @Equals(true)
  consent!: boolean;
}
export class PortfolioImportStatusDto {
  @ApiProperty({ example: 'pi_...' }) import_id!: string;
  @ApiProperty({
    example: 'AWAITING_AUTHORISATION',
    enum: [
      'AWAITING_AUTHORISATION',
      'IMPORTED',
      'FAILED',
      'DECLINED',
      'EXPIRED',
      'SKIPPED',
    ],
  })
  status!: string;
  @ApiProperty({
    required: false,
    example: 'provider_rejected',
    description:
      'provider_rejected | provider_unavailable | authorisation_declined | invalid_payload | expired',
  })
  failure_category?: string;
  @ApiProperty({
    required: false,
    example:
      'http://localhost:4011/investor?reqId=4123456789&clientRefNo=pi_...',
    description:
      'Send the browser here while AWAITING_AUTHORISATION; MF Central brings it back to the backend callback, which redirects to MFCENTRAL_RETURN_URL?import_id=…&status=received',
  })
  authorisation_url?: string;
  @ApiProperty({ required: false, example: '2026-10-19T10:15:00.000Z' })
  expires_at?: string;
  @ApiProperty({
    example: 'PORTFOLIO_IMPORT',
    description: 'ASSETS_DASHBOARD once IMPORTED',
  })
  next_screen!: string;
}
export class PortfolioSkipResponseDto {
  @ApiProperty({ example: 'SKIPPED' }) status!: string;
  @ApiProperty({ example: 'KYC_PROGRESS' }) next_screen!: string;
}

class PortfolioInvestorDto {
  @ApiProperty({ required: false, example: 'VINOD KUMAR SINGH' }) name?: string;
  @ApiProperty({ example: 'AB••••••4J' }) pan_masked!: string;
}
class PortfolioTotalsDto {
  @ApiProperty({ example: 1234567.89 }) market_value_inr!: number;
  @ApiProperty({ required: false, example: 1000000 }) cost_value_inr?: number;
  @ApiProperty({ required: false, example: 234567.89 }) gain_inr?: number;
  @ApiProperty({ required: false, example: 23.5 }) gain_pct?: number;
  @ApiProperty({ example: 2 }) folio_count!: number;
  @ApiProperty({ example: 4 }) scheme_count!: number;
}
class AssetClassSliceDto {
  @ApiProperty({
    example: 'EQUITY',
    enum: ['EQUITY', 'DEBT', 'HYBRID', 'OTHER'],
  })
  asset_class!: string;
  @ApiProperty({ example: 800000 }) market_value_inr!: number;
  @ApiProperty({ example: 64.8 }) weight_pct!: number;
}
class PortfolioHoldingDto {
  @ApiProperty({ example: 'JioBlackRock Mutual Fund' }) amc!: string;
  @ApiProperty({ example: 'JioBlackRock Flexi Cap Fund - Direct Growth' })
  scheme_name!: string;
  @ApiProperty({ required: false, example: 'INF0JBR00011' }) isin?: string;
  @ApiProperty({ example: '••••1/45' }) folio_masked!: string;
  @ApiProperty({ example: 'EQUITY' }) asset_class!: string;
  @ApiProperty({ example: 1200 }) units!: number;
  @ApiProperty({ example: 18.42 }) nav!: number;
  @ApiProperty({ required: false, example: '2026-10-18' }) nav_date?: string;
  @ApiProperty({ example: 22104 }) market_value_inr!: number;
  @ApiProperty({ required: false, example: 18000 }) cost_value_inr?: number;
}
export class PortfolioResponseDto {
  @ApiProperty({
    example: 'AVAILABLE',
    enum: ['AVAILABLE', 'NOT_AVAILABLE', 'SKIPPED'],
  })
  status!: string;
  @ApiProperty({ required: false, example: 'pi_...' }) import_id?: string;
  @ApiProperty({ example: 'MFCENTRAL' }) source!: string;
  @ApiProperty({ required: false, example: '2026-10-18' }) as_of?: string;
  @ApiProperty({ required: false, type: PortfolioInvestorDto })
  investor?: PortfolioInvestorDto;
  @ApiProperty({ required: false, type: PortfolioTotalsDto })
  totals?: PortfolioTotalsDto;
  @ApiProperty({ required: false, type: [AssetClassSliceDto] })
  by_asset_class?: AssetClassSliceDto[];
  @ApiProperty({ required: false, type: [PortfolioHoldingDto] })
  holdings?: PortfolioHoldingDto[];
  @ApiProperty({
    example: 'KYC_PROGRESS',
    description: 'Where "Continue" goes from the dashboard',
  })
  next_screen!: string;
}
