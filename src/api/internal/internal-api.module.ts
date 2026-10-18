import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../application/application.module';
import { MessagingModule } from '../../infrastructure/messaging/messaging.module';
import { DevOtpController } from './dev-otp.controller';
import { InternalOperationsController } from './internal-operations.controller';
import { ReviewController } from './review.controller';
import { ReviewerGuard } from '../../common/auth/reviewer.guard';

@Module({
  imports: [ApplicationServicesModule, MessagingModule],
  controllers: [
    InternalOperationsController,
    ReviewController,
    DevOtpController,
  ],
  providers: [ReviewerGuard],
})
export class InternalApiModule {}
