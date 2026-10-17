import { Global, Module } from '@nestjs/common';
import { InternalServiceGuard } from './internal-service.guard';

@Global()
@Module({ providers: [InternalServiceGuard], exports: [InternalServiceGuard] })
export class AuthModule {}
