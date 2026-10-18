import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../../application/application.module';
import { ApplicationController } from './application.controller';
import { DocumentsController } from './documents.controller';
import { EmailChallengeController } from './email-challenge.controller';
import { KycController } from './kyc.controller';
import { PortfolioController } from './portfolio.controller';
import { ProfileBankNominationController } from './phase4.controller';
import { SuitabilityFeesReviewController } from './phase5.controller';
import {
  FundingController,
  SigningProcessingController,
} from './phase6.controller';

@Module({
  imports: [ApplicationServicesModule],
  controllers: [
    EmailChallengeController,
    ApplicationController,
    KycController,
    PortfolioController,
    DocumentsController,
    ProfileBankNominationController,
    SuitabilityFeesReviewController,
    SigningProcessingController,
    FundingController,
  ],
})
export class OnboardingApiModule {}
