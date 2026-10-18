import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../../application/application.module';
import { ApplicationController } from './application.controller';
import { EmailChallengeController } from './email-challenge.controller';

@Module({
  imports: [ApplicationServicesModule],
  controllers: [EmailChallengeController, ApplicationController],
})
export class OnboardingApiModule {}
