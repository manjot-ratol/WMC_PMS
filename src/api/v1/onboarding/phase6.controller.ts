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
import { FundingService } from '../../../application/funding/funding.service';
import { ProcessingService } from '../../../application/processing/processing.service';
import { SigningService } from '../../../application/signing/signing.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  CompletionDto,
  FundingInstructionsDto,
  FundingNotificationDto,
  FundingNotificationResponseDto,
  FundingStatusDto,
  ProcessingStatusDto,
  SigningSessionDto,
  SigningSessionResponseDto,
  SigningSessionStatusDto,
  TaskResponseDto,
  TaskResponseResultDto,
} from './phase6.dto';

@ApiTags('onboarding')
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'Required on POST',
})
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 409, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id')
export class SigningProcessingController {
  constructor(
    private readonly signing: SigningService,
    private readonly processing: ProcessingService,
  ) {}

  @Post('signing-sessions')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 21: render the document pack from the snapshot and create the Digio sign request',
  })
  @ApiResponse({ status: 201, type: SigningSessionResponseDto })
  async createSigning(
    @Param('application_id') applicationId: string,
    @Body() body: SigningSessionDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<SigningSessionResponseDto> {
    const r = await this.signing.create({
      applicationId,
      customerId: p.id,
      snapshotId: body.snapshot_id,
      documentPackVersion: body.document_pack_version,
      signingMethod: body.signing_method,
    });
    return {
      signing_session_id: r.signingSessionId,
      status: r.status,
      provider_request_id: r.providerRequestId,
      sdk_launch: { access_token: r.sdkLaunch.accessToken },
    };
  }

  @Get('signing-sessions/:signing_session_id')
  @ApiOperation({
    summary:
      'Screen 21: backend-confirmed signing status (never trusts the SDK return)',
  })
  @ApiResponse({ status: 200, type: SigningSessionStatusDto })
  async signingStatus(
    @Param('application_id') applicationId: string,
    @Param('signing_session_id') sessionId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<SigningSessionStatusDto> {
    const r = await this.signing.get(applicationId, p.id, sessionId);
    return {
      status: r.status,
      document_pack_version: r.documentPackVersion,
      evidence_available: r.evidenceAvailable,
      next_screen: r.nextScreen,
    };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Screen 22: processing progress and customer-visible tasks',
  })
  @ApiResponse({ status: 200, type: ProcessingStatusDto })
  async status(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<ProcessingStatusDto> {
    const r = await this.processing.status(applicationId, p.id);
    return {
      application_status: r.applicationStatus,
      tasks: r.tasks.map((t) => ({
        task_id: t.taskId,
        category: t.category,
        status: t.status,
      })),
      customer_action_required: r.customerActionRequired,
      next_screen: r.nextScreen,
    };
  }

  @Post('tasks/:task_id/responses')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Screen 22: respond to a clarification task' })
  @ApiResponse({ status: 200, type: TaskResponseResultDto })
  async respond(
    @Param('application_id') applicationId: string,
    @Param('task_id') taskId: string,
    @Body() body: TaskResponseDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<TaskResponseResultDto> {
    const r = await this.processing.respond({
      applicationId,
      customerId: p.id,
      taskId,
      responseType: body.response_type,
      documentIds: body.document_ids ?? [],
      text: body.text,
    });
    return { status: r.status, task_status: r.taskStatus };
  }
}

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
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  @Get('funding-instructions')
  @ApiOperation({
    summary:
      'Screen 23: approved receiving arrangement, released only after execution and account readiness',
  })
  @ApiResponse({ status: 200, type: FundingInstructionsDto })
  async instructions(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<FundingInstructionsDto> {
    const r = await this.funding.instructions(applicationId, p.id);
    return {
      status: r.status,
      instructions_version: r.instructionsVersion,
      beneficiary_details: {
        account_name: r.beneficiaryDetails.accountName,
        account_number_masked: r.beneficiaryDetails.accountNumberMasked,
        ifsc: r.beneficiaryDetails.ifsc,
        bank_name: r.beneficiaryDetails.bankName,
      },
      payment_reference: r.paymentReference,
      required_amount_inr: r.requiredAmountInr,
    };
  }

  @Post('funding-notifications')
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @ApiOperation({
    summary:
      'Screen 23: customer says they have transferred (a hint, not proof)',
  })
  @ApiResponse({ status: 202, type: FundingNotificationResponseDto })
  async notify(
    @Param('application_id') applicationId: string,
    @Body() body: FundingNotificationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<FundingNotificationResponseDto> {
    const r = await this.funding.notify({
      applicationId,
      customerId: p.id,
      fundingMethod: body.funding_method,
      customerTransferReference: body.customer_transfer_reference,
    });
    return {
      status: r.status,
      notification_id: r.notificationId,
      next_screen: r.nextScreen,
    };
  }

  @Get('funding-status')
  @ApiOperation({
    summary:
      'Screen 24: reconciled funding and activation readiness (read-only)',
  })
  @ApiResponse({ status: 200, type: FundingStatusDto })
  async status(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<FundingStatusDto> {
    const r = await this.funding.status(applicationId, p.id);
    return {
      funding_status: r.fundingStatus,
      activation_status: r.activationStatus,
      customer_action_required: r.customerActionRequired,
      next_screen: r.nextScreen,
    };
  }

  @Get('completion')
  @ApiOperation({ summary: 'Screen 25: backend-confirmed active account' })
  @ApiResponse({ status: 200, type: CompletionDto })
  async completion(
    @Param('application_id') applicationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<CompletionDto> {
    const r = await this.funding.completion(applicationId, p.id);
    return {
      application_status: r.applicationStatus,
      pms_account_id: r.pmsAccountId,
      onboarding_complete: r.onboardingComplete,
      first_investment_status: r.firstInvestmentStatus,
      next_screen: r.nextScreen,
    };
  }
}
