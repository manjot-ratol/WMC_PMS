import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FeesService } from '../../../application/fees/fees.service';
import { ReviewService } from '../../../application/review/review.service';
import { SuitabilityService } from '../../../application/suitability/suitability.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  AcknowledgementsDto,
  AcknowledgementsResponseDto,
  FeeIllustrationDto,
  FeeIllustrationResponseDto,
  InvestmentApproachDto,
  InvestmentApproachResponseDto,
  ReviewConfirmationDto,
  ReviewConfirmationResponseDto,
  ReviewSummaryDto,
  SuitabilityAssessmentDto,
  SuitabilityAssessmentResponseDto,
} from './phase5.dto';

@ApiTags('onboarding')
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'Required on POST/PUT',
})
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 409, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id')
export class SuitabilityFeesReviewController {
  constructor(
    private readonly suitability: SuitabilityService,
    private readonly fees: FeesService,
    private readonly review: ReviewService,
  ) {}

  @Post('suitability-assessments')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 17: submit questionnaire answers (scored server-side)',
  })
  @ApiResponse({ status: 200, type: SuitabilityAssessmentResponseDto })
  async assess(
    @Param('application_id') applicationId: string,
    @Body() body: SuitabilityAssessmentDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<SuitabilityAssessmentResponseDto> {
    const r = await this.suitability.assess({
      applicationId,
      customerId: p.id,
      questionnaireVersion: body.questionnaire_version,
      answers: body.answers.map((a) => ({
        questionId: a.question_id,
        answerId: a.answer_id,
      })),
    });
    return {
      assessment_id: r.assessmentId,
      status: r.status,
      missing_question_ids: r.missingQuestionIds,
      next_screen: r.nextScreen,
    };
  }

  @Put('investment-approach')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 18: confirm the approach the assessment permits',
  })
  @ApiResponse({ status: 200, type: InvestmentApproachResponseDto })
  async confirmApproach(
    @Param('application_id') applicationId: string,
    @Body() body: InvestmentApproachDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<InvestmentApproachResponseDto> {
    const r = await this.suitability.confirmApproach({
      applicationId,
      customerId: p.id,
      assessmentId: body.assessment_id,
      assessmentVersion: body.assessment_version,
      approachCode: body.approach_code,
      confirmed: body.confirmed,
    });
    return {
      status: r.status,
      approach_version: r.approachVersion,
      next_screen: r.nextScreen,
    };
  }

  @Post('fee-illustrations')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 19: server-backed fee illustration for an approved scenario',
  })
  @ApiResponse({ status: 200, type: FeeIllustrationResponseDto })
  async illustrate(
    @Param('application_id') applicationId: string,
    @Body() body: FeeIllustrationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<FeeIllustrationResponseDto> {
    const r = await this.fees.illustrate({
      applicationId,
      customerId: p.id,
      approachCode: body.approach_code,
      feeScheduleVersion: body.fee_schedule_version,
      scenarioCode: body.scenario_code,
    });
    return {
      status: r.status,
      illustration_id: r.illustrationId,
      line_items: r.lineItems.map((l) => ({
        code: l.code,
        amount_inr: l.amountInr,
      })),
      disclaimer_version: r.disclaimerVersion,
    };
  }

  @Post('acknowledgements')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 19: record distinct acknowledgements and the fee-understanding note',
  })
  @ApiResponse({ status: 200, type: AcknowledgementsResponseDto })
  async acknowledge(
    @Param('application_id') applicationId: string,
    @Body() body: AcknowledgementsDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<AcknowledgementsResponseDto> {
    const r = await this.fees.acknowledge({
      applicationId,
      customerId: p.id,
      documentPackVersion: body.document_pack_version,
      acknowledgements: body.acknowledgements.map((a) => ({
        documentType: a.document_type,
        documentVersion: a.document_version,
        acknowledged: a.acknowledged,
      })),
      feeUnderstandingNote: body.fee_understanding_note,
    });
    return {
      status: r.status,
      fee_annexure_execution_required: r.feeAnnexureExecutionRequired,
      next_screen: r.nextScreen,
    };
  }

  @Get('review')
  @ApiOperation({
    summary:
      'Screen 20: masked review summary, current versions and open gates (side-effect free)',
  })
  @ApiResponse({ status: 200, type: ReviewSummaryDto })
  async getReview(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<ReviewSummaryDto> {
    const r = await this.review.get(applicationId, p.id);
    return {
      application_version: r.applicationVersion,
      document_pack_version: r.documentPackVersion,
      ready: r.ready,
      blockers: r.blockers,
      sections: r.sections as unknown as Record<string, unknown>,
    };
  }

  @Post('review-confirmations')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 20: confirm the review and create the immutable snapshot for signing',
  })
  @ApiResponse({ status: 200, type: ReviewConfirmationResponseDto })
  async confirmReview(
    @Param('application_id') applicationId: string,
    @Body() body: ReviewConfirmationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<ReviewConfirmationResponseDto> {
    const r = await this.review.confirm({
      applicationId,
      customerId: p.id,
      applicationVersion: body.application_version,
      documentPackVersion: body.document_pack_version,
      detailsConfirmed: body.details_confirmed,
    });
    return {
      status: r.status,
      snapshot_id: r.snapshotId,
      next_screen: r.nextScreen,
    };
  }
}
