import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../application/application.module';
import { InternalOperationsController } from './internal-operations.controller';

@Module({
  imports: [ApplicationServicesModule],
  controllers: [InternalOperationsController],
})
export class InternalApiModule {}
