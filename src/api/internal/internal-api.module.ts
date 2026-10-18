import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../application/application.module';
import { InternalOperationsController } from './internal-operations.controller';
import { ReviewController } from './review.controller';
import { ReviewerGuard } from '../../common/auth/reviewer.guard';

@Module({
  imports: [ApplicationServicesModule],
  controllers: [InternalOperationsController, ReviewController],
  providers: [ReviewerGuard],
})
export class InternalApiModule {}
