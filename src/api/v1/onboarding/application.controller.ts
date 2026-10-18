import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApplicationQueryService } from '../../../application/onboarding/application-query.service';
import { EligibilityService } from '../../../application/onboarding/eligibility.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  ApplicationSummaryDto,
  EligibilityDto,
  EligibilityResponseDto,
} from './onboarding.dto';

@ApiTags('onboarding')
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id')
export class ApplicationController {
  constructor(
    private readonly query: ApplicationQueryService,
    private readonly eligibilityService: EligibilityService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Resume: current status, next screen and completed steps (side-effect free)',
  })
  @ApiResponse({ status: 200, type: ApplicationSummaryDto })
  async get(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<ApplicationSummaryDto> {
    const s = await this.query.get(applicationId, p.id);
    return {
      application_id: s.applicationId,
      status: s.status,
      next_screen: s.nextScreen,
      version: s.version,
      journey_version: s.journeyVersion,
      steps: s.steps.map((st) => ({
        step_id: st.stepId,
        status: st.status,
        completed_at: st.completedAt?.toISOString(),
      })),
    };
  }

  @Put('eligibility')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Screen 05: evaluate eligibility and product route',
  })
  @ApiResponse({ status: 200, type: EligibilityResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async evaluateEligibility(
    @Param('application_id') applicationId: string,
    @Body() body: EligibilityDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<EligibilityResponseDto> {
    const d = await this.eligibilityService.evaluate(applicationId, p.id, {
      customerType: body.customer_type,
      residentialStatus: body.residential_status,
      intendedInvestmentInr: body.intended_investment_inr,
      distributionRoute: body.distribution_route,
    });
    return {
      status: d.status,
      ruleset_version: d.rulesetVersion,
      journey_route: d.journeyRoute,
      next_screen: d.nextScreen,
    };
  }
}
