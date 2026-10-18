import { Global, Module } from '@nestjs/common';
import { ApplicationOwnershipGuard } from './application-ownership.guard';
import { InternalServiceGuard } from './internal-service.guard';
import { PreAuthGuard } from './preauth.guard';
import { SessionGuard } from './session.guard';

@Global()
@Module({
  providers: [
    InternalServiceGuard,
    PreAuthGuard,
    SessionGuard,
    ApplicationOwnershipGuard,
  ],
  exports: [
    InternalServiceGuard,
    PreAuthGuard,
    SessionGuard,
    ApplicationOwnershipGuard,
  ],
})
export class AuthModule {}
