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
import { BankVerificationService } from '../../../application/bank/bank-verification.service';
import { NominationService } from '../../../application/nomination/nomination.service';
import { DeclarationsService } from '../../../application/profile/declarations.service';
import { ProfileService } from '../../../application/profile/profile.service';
import { UseApplicationSession } from '../../../common/auth/auth.decorators';
import { CurrentPrincipal } from '../../../common/auth/principal.decorator';
import type { Principal } from '../../../common/auth/principal';
import { Idempotent } from '../../../common/idempotency/idempotency.decorator';
import { ApiErrorDto } from '../../shared/api-error.dto';
import {
  BankVerificationDto,
  BankVerificationStartedDto,
  BankVerificationStatusDto,
  DeclarationsDto,
  DeclarationsResponseDto,
  NominationDto,
  NominationResponseDto,
  ProfileDto,
  ProfileResponseDto,
} from './phase4.dto';

@ApiTags('onboarding')
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'Required on POST/PUT',
})
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
@UseApplicationSession()
@Controller('v1/onboarding/applications/:application_id')
export class ProfileBankNominationController {
  constructor(
    private readonly profile: ProfileService,
    private readonly declarations: DeclarationsService,
    private readonly bank: BankVerificationService,
    private readonly nomination: NominationService,
  ) {}

  @Put('profile')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 12: save the personal and financial profile',
  })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async saveProfile(
    @Param('application_id') applicationId: string,
    @Body() body: ProfileDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<ProfileResponseDto> {
    const r = await this.profile.save({
      applicationId,
      customerId: p.id,
      occupation: body.occupation,
      annualIncomeBand: body.annual_income_band,
      sourceOfFunds: body.source_of_funds,
      sourceOfFundsExplanation: body.source_of_funds_explanation,
      profileVersion: body.profile_version,
    });
    return {
      status: r.status,
      profile_version: r.profileVersion,
      next_screen: r.nextScreen,
    };
  }

  @Put('declarations')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Screen 13: tax residencies and PEP declaration' })
  @ApiResponse({ status: 200, type: DeclarationsResponseDto })
  async saveDeclarations(
    @Param('application_id') applicationId: string,
    @Body() body: DeclarationsDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<DeclarationsResponseDto> {
    const r = await this.declarations.save({
      applicationId,
      customerId: p.id,
      taxResidencies: body.tax_residencies.map((t) => ({
        country: t.country,
        tin: t.tin ?? null,
        tinUnavailableReason: t.tin_unavailable_reason ?? null,
      })),
      pepDeclaration: body.pep_declaration,
      declarationVersion: body.declaration_version,
    });
    return {
      status: r.status,
      additional_information_required: r.additionalInformationRequired,
      next_screen: r.nextScreen,
    };
  }

  @Post('bank-verifications')
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @ApiOperation({
    summary: 'Screen 14: start bank account ownership verification',
  })
  @ApiResponse({ status: 202, type: BankVerificationStartedDto })
  async startBank(
    @Param('application_id') applicationId: string,
    @Body() body: BankVerificationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<BankVerificationStartedDto> {
    const r = await this.bank.start({
      applicationId,
      customerId: p.id,
      accountNumber: body.account_number,
      accountNumberConfirmation: body.account_number_confirmation,
      ifsc: body.ifsc,
      holderName: body.holder_name,
    });
    return {
      verification_id: r.verificationId,
      status: r.status,
      next_screen: r.nextScreen,
    };
  }

  @Get('bank-verifications/:verification_id')
  @ApiOperation({
    summary:
      'Screen 15: bank verification result (read-only; never re-triggers a check)',
  })
  @ApiResponse({ status: 200, type: BankVerificationStatusDto })
  async bankStatus(
    @Param('application_id') applicationId: string,
    @Param('verification_id') verificationId: string,
    @CurrentPrincipal() p: Principal,
  ): Promise<BankVerificationStatusDto> {
    const r = await this.bank.get(applicationId, p.id, verificationId);
    return {
      status: r.status,
      account_masked: r.accountMasked,
      required_actions: r.requiredActions,
      next_screen: r.nextScreen,
    };
  }

  @Put('nomination')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Screen 16: nomination choice' })
  @ApiResponse({ status: 200, type: NominationResponseDto })
  async saveNomination(
    @Param('application_id') applicationId: string,
    @Body() body: NominationDto,
    @CurrentPrincipal() p: Principal,
  ): Promise<NominationResponseDto> {
    const r = await this.nomination.save({
      applicationId,
      customerId: p.id,
      choice: body.choice,
      allocationMode: body.allocation_mode,
      nominees: body.nominees.map((n) => ({
        fullName: n.full_name,
        relationship: n.relationship,
        isMinor: n.is_minor,
        dateOfBirth: n.date_of_birth,
        allocationPercent: n.allocation_percent,
        guardian: n.guardian
          ? {
              fullName: n.guardian.full_name,
              relationship: n.guardian.relationship,
            }
          : undefined,
      })),
    });
    return {
      status: r.status,
      registration_status: r.registrationStatus,
      nomination_version: r.nominationVersion,
      next_screen: r.nextScreen,
    };
  }
}
