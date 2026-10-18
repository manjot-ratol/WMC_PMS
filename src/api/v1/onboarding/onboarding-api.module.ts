import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../../application/application.module';
import { ApplicationController } from './application.controller';
import { DocumentsController } from './documents.controller';
import { EmailChallengeController } from './email-challenge.controller';
import { KycController } from './kyc.controller';

@Module({
  imports: [ApplicationServicesModule],
  controllers: [
    EmailChallengeController,
    ApplicationController,
    KycController,
    DocumentsController,
  ],
})
export class OnboardingApiModule {}
