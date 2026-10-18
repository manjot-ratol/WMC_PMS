import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../../application/application.module';
import { PhoneChallengeController } from './phone-challenge.controller';

@Module({
  imports: [ApplicationServicesModule],
  controllers: [PhoneChallengeController],
})
export class AuthApiModule {}
