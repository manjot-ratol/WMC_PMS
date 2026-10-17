import { Module } from '@nestjs/common';
import { KRA_GATEWAY } from '../../../application/ports/kra-gateway.port';
import { DigioKraGateway } from './kra/kra.gateway';

/** Digio partner adapters. Import where a service needs a Digio port; inject by port token. */
@Module({
  providers: [
    DigioKraGateway,
    { provide: KRA_GATEWAY, useExisting: DigioKraGateway },
  ],
  exports: [KRA_GATEWAY, DigioKraGateway],
})
export class DigioModule {}
