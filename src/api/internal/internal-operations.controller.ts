import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountOpeningService } from '../../application/account-opening/account-opening.service';
import { FundingService } from '../../application/funding/funding.service';
import { UseInternal } from '../../common/auth/auth.decorators';
import { ApiErrorDto } from '../shared/api-error.dto';
import {
  AccountOpeningRunDto,
  AccountOpeningRunResponseDto,
  FundingReceiptDto,
  FundingReceiptResponseDto,
  UnderlyingAccountDto,
  UnderlyingAccountResponseDto,
} from './internal.dto';

/** Service-to-service feeds (custodian/DP, bank reconciliation, ops). Never reachable through the public gateway. */
@ApiTags('internal')
@ApiHeader({ name: 'X-Internal-Token', required: true })
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 404, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseInternal()
@Controller('internal/v1/applications/:application_id')
export class InternalOperationsController {
  constructor(
    private readonly accountOpening: AccountOpeningService,
    private readonly funding: FundingService,
  ) {}

  @Post('account-opening-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Job C: queue (or re-queue) registry filing and account opening for the current snapshot',
  })
  @ApiResponse({ status: 202, type: AccountOpeningRunResponseDto })
  async run(
    @Param('application_id') applicationId: string,
    @Body() body: AccountOpeningRunDto,
    @Headers('x-reviewer-id') reviewer?: string,
  ): Promise<AccountOpeningRunResponseDto> {
    const r = await this.accountOpening.requestRun({
      applicationId,
      snapshotId: body.snapshot_id,
      documentPackVersion: body.document_pack_version,
      requestedBy: reviewer ?? 'internal',
    });
    return { run_id: r.runId, status: r.status };
  }

  @Post('underlying-accounts')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Custodian/DP feed: an underlying account is pending, ready or rejected',
  })
  @ApiResponse({ status: 202, type: UnderlyingAccountResponseDto })
  async underlyingAccount(
    @Param('application_id') applicationId: string,
    @Body() body: UnderlyingAccountDto,
  ): Promise<UnderlyingAccountResponseDto> {
    const r = await this.accountOpening.recordUnderlyingAccount({
      applicationId,
      providerReceiptKey: body.provider_receipt_key,
      provider: body.provider,
      accountType: body.account_type,
      accountReference: body.account_reference,
      status: body.status,
    });
    return {
      account_id: r.accountId,
      status: r.status,
      accounts_ready: r.accountsReady,
    };
  }

  @Post('funding-receipts')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Bank/custodian feed: authenticated evidence of a receipt (reconciled against the verified account)',
  })
  @ApiResponse({ status: 202, type: FundingReceiptResponseDto })
  async receipt(
    @Param('application_id') applicationId: string,
    @Body() body: FundingReceiptDto,
  ): Promise<FundingReceiptResponseDto> {
    const r = await this.funding.recordReceipt({
      applicationId,
      providerReceiptKey: body.provider_receipt_key,
      provider: body.provider,
      amountInr: body.amount_inr,
      currency: body.currency,
      sourceAccountNumber: body.source_account_number,
      destinationReference: body.destination_reference,
      valueDate: body.value_date,
    });
    return {
      receipt_id: r.receiptId,
      status: r.status,
      match_status: r.matchStatus,
      funding_status: r.fundingStatus,
    };
  }
}
