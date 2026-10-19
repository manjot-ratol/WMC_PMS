import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PortfolioImportService,
  type PortfolioImportView,
} from '../../../application/portfolio/portfolio-import.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import type { Principal } from '../../../common/auth/principal';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  PortfolioImportDto,
  PortfolioImportStatusDto,
  QrValidationDto,
  PortfolioResponseDto,
  PortfolioSkipResponseDto,
} from './portfolio.dto';

@ApiTags('onboarding')
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'Required on POST',
})
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id')
export class PortfolioController {
  constructor(private readonly service: PortfolioImportService) {}

  @Post('portfolio-imports')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 06A: start the MF Central CAS import (after PAN identity); returns the investor authorisation URL',
  })
  @ApiResponse({ status: 201, type: PortfolioImportStatusDto })
  @ApiResponse({ status: 503, type: ApiErrorDto })
  async start(
    @Param('application_id') applicationId: string,
    @Body() body: PortfolioImportDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<PortfolioImportStatusDto> {
    return toDto(
      await this.service.start({
        applicationId,
        customerId: p.id,
        consent: body.consent,
      }),
    );
  }

  @Post('portfolio-imports/skip')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 06A: continue without importing holdings',
  })
  @ApiResponse({ status: 200, type: PortfolioSkipResponseDto })
  async skip(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<PortfolioSkipResponseDto> {
    const r = await this.service.skip({ applicationId, customerId: p.id });
    return { status: r.status, next_screen: r.nextScreen };
  }

  @Post('portfolio-imports/:import_id/qr-validations')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 06A: upload the QR image downloaded from MF Central; the backend validates it with MF Central and imports the statement',
  })
  @ApiResponse({ status: 200, type: PortfolioImportStatusDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async validateQr(
    @Param('application_id') applicationId: string,
    @Param('import_id') importId: string,
    @Body() body: QrValidationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<PortfolioImportStatusDto> {
    return toDto(
      await this.service.validateQr({
        applicationId,
        customerId: p.id,
        importId,
        qrCode: body.qr_code,
      }),
    );
  }

  @Get('portfolio-imports/:import_id')
  @ApiOperation({
    summary:
      'Screen 06A: import status (poll after the browser returns from MF Central)',
  })
  @ApiResponse({ status: 200, type: PortfolioImportStatusDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async get(
    @Param('application_id') applicationId: string,
    @Param('import_id') importId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<PortfolioImportStatusDto> {
    return toDto(
      await this.service.get({ applicationId, customerId: p.id, importId }),
    );
  }

  @Get('portfolio')
  @ApiOperation({
    summary:
      'Screen 06B: assets dashboard from the imported statement (masked)',
  })
  @ApiResponse({ status: 200, type: PortfolioResponseDto })
  async portfolio(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<PortfolioResponseDto> {
    const r = await this.service.portfolio({ applicationId, customerId: p.id });
    const d = r.data;
    return {
      status: r.status,
      import_id: r.importId,
      source: 'MFCENTRAL',
      partial: d?.partial,
      notice: d?.notice,
      as_of: d?.asOf,
      investor: d
        ? { name: d.investor.name, pan_masked: d.investor.panMasked }
        : undefined,
      totals: d
        ? {
            market_value_inr: d.totals.marketValueInr,
            cost_value_inr: d.totals.costValueInr,
            gain_inr: d.totals.gainInr,
            gain_pct: d.totals.gainPct,
            folio_count: d.totals.folioCount,
            scheme_count: d.totals.schemeCount,
          }
        : undefined,
      by_asset_class: d?.byAssetClass.map((s) => ({
        asset_class: s.assetClass,
        market_value_inr: s.marketValueInr,
        weight_pct: s.weightPct,
      })),
      by_amc: d?.byAmc.map((s) => ({
        amc: s.amc,
        market_value_inr: s.marketValueInr,
        weight_pct: s.weightPct,
        scheme_count: s.schemeCount,
      })),
      holdings: d?.holdings.map((h) => ({
        amc: h.amc,
        scheme_name: h.schemeName,
        isin: h.isin,
        folio_masked: h.folioMasked,
        asset_class: h.assetClass,
        scheme_type: h.schemeType,
        plan: h.plan,
        units: h.units,
        nav: h.nav,
        nav_date: h.navDate,
        market_value_inr: h.marketValueInr,
        cost_value_inr: h.costValueInr,
        gain_inr: h.gainInr,
        gain_pct: h.gainPct,
        rta: h.rta,
        demat: h.demat,
      })),
      next_screen: r.nextScreen,
    };
  }
}

function toDto(v: PortfolioImportView): PortfolioImportStatusDto {
  return {
    import_id: v.importId,
    status: v.status,
    failure_category: v.failureCategory,
    last_error: v.lastError,
    authorisation_url: v.authorisationUrl,
    expires_at: v.expiresAt?.toISOString(),
    next_screen: v.nextScreen,
  };
}
