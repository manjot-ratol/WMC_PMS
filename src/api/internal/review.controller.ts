import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BackOfficeReviewService } from '../../application/back-office/back-office-review.service';
import type { CaseStatus } from '../../application/ports/compliance.repository.port';
import type { TaskRecord } from '../../application/ports/verification.repository.port';
import { ReviewerGuard } from '../../common/auth/reviewer.guard';
import { ValidationError } from '../../common/errors/app-error';
import { ApiErrorDto } from '../shared/api-error.dto';
import {
  BankEvidenceDto,
  BankEvidenceResponseDto,
  CaseDto,
  DecisionDto,
  DecisionResponseDto,
  ReviewTaskDto,
  TaskResolutionDto,
  TaskResolutionResponseDto,
} from './review.dto';

const CASE_STATUSES: CaseStatus[] = ['OPEN', 'UNDER_REVIEW', 'CLOSED'];
const TASK_STATUSES: TaskRecord['status'][] = [
  'OPEN',
  'IN_PROGRESS',
  'UNDER_REVIEW',
  'RESOLVED',
];

/** Minimal reviewer surface: service token + mandatory X-Reviewer-Id (recorded on every decision and audit row). */
@ApiTags('internal-review')
@ApiHeader({ name: 'X-Internal-Token', required: true })
@ApiHeader({ name: 'X-Reviewer-Id', required: true })
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 404, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseGuards(ReviewerGuard)
@Controller('internal/v1/review')
export class ReviewController {
  constructor(private readonly review: BackOfficeReviewService) {}

  @Get('cases')
  @ApiOperation({ summary: 'Open compliance cases (restricted)' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'OPEN (default) | UNDER_REVIEW | CLOSED',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: [CaseDto] })
  async cases(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<CaseDto[]> {
    const statuses = parseStatuses(status, CASE_STATUSES, ['OPEN']);
    const rows = await this.review.listCases(statuses, Number(limit ?? 50));
    return rows.map((c) => ({
      case_id: c.caseId,
      application_id: c.applicationId,
      kind: c.kind,
      severity: c.severity,
      status: c.status,
      source_run_id: c.sourceRunId,
      provider_case_id: c.providerCaseId,
      summary: c.summary,
      created_at: c.createdAt.toISOString(),
    }));
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Tasks awaiting the back office' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'comma-separated; default OPEN,UNDER_REVIEW',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: [ReviewTaskDto] })
  async tasks(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<ReviewTaskDto[]> {
    const statuses = parseStatuses(status, TASK_STATUSES, [
      'OPEN',
      'UNDER_REVIEW',
    ]);
    const rows = await this.review.listTasks(statuses, Number(limit ?? 50));
    return rows.map((t) => ({
      task_id: t.taskId,
      application_id: t.applicationId,
      category: t.category,
      status: t.status,
      customer_visible: t.customerVisible,
      created_at: t.createdAt.toISOString(),
    }));
  }

  @Post('cases/:case_id/decisions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record a review decision (PROCEED / HOLD / REJECT) with a documented reason',
  })
  @ApiResponse({ status: 200, type: DecisionResponseDto })
  async decide(
    @Param('case_id') caseId: string,
    @Body() body: DecisionDto,
    @Headers('x-reviewer-id') reviewerId: string,
  ): Promise<DecisionResponseDto> {
    const r = await this.review.decide({
      caseId,
      reviewerId,
      decision: body.decision,
      reason: body.reason,
    });
    return {
      case_id: r.caseId,
      case_status: r.caseStatus,
      decision_id: r.decisionId,
    };
  }

  @Post('applications/:application_id/bank-evidence')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept bank ownership evidence for a verification the name match could not clear',
  })
  @ApiResponse({ status: 200, type: BankEvidenceResponseDto })
  async bankEvidence(
    @Param('application_id') applicationId: string,
    @Body() body: BankEvidenceDto,
    @Headers('x-reviewer-id') reviewerId: string,
  ): Promise<BankEvidenceResponseDto> {
    const r = await this.review.acceptBankEvidence({
      applicationId,
      verificationId: body.verification_id,
      reviewerId,
      reason: body.reason,
    });
    return { verification_id: r.verificationId, status: r.status };
  }

  @Post('tasks/:task_id/resolution')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve (or reopen) a task' })
  @ApiResponse({ status: 200, type: TaskResolutionResponseDto })
  async resolve(
    @Param('task_id') taskId: string,
    @Body() body: TaskResolutionDto,
    @Headers('x-reviewer-id') reviewerId: string,
  ): Promise<TaskResolutionResponseDto> {
    const r = await this.review.resolveTask({
      taskId,
      reviewerId,
      resolution: body.resolution,
      reason: body.reason,
    });
    return { task_id: r.taskId, status: r.status };
  }
}

function parseStatuses<T extends string>(
  raw: string | undefined,
  allowed: T[],
  fallback: T[],
): T[] {
  if (!raw) return fallback;
  const parts = raw.split(',').map((s) => s.trim().toUpperCase()) as T[];
  const bad = parts.find((p) => !allowed.includes(p));
  if (bad)
    throw new ValidationError(undefined, {
      details: { field: 'status', allowed },
    });
  return parts;
}
