import { Module } from '@nestjs/common';
import { DIGISTUDIO_GATEWAY } from '../../../application/ports/digistudio-gateway.port';
import { FACE_GATEWAY } from '../../../application/ports/face-gateway.port';
import { KRA_GATEWAY } from '../../../application/ports/kra-gateway.port';
import { DigiStudioGateway } from './digistudio/digistudio.gateway';
import { DigioFaceGateway } from './face/face.gateway';
import { DigioWebhookVerifier } from './webhooks/digio-webhook.verifier';
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
