import { Global, Module } from '@nestjs/common';
import { BANK_GATEWAY } from '../../../application/ports/bank-gateway.port';
import { DIGISTUDIO_GATEWAY } from '../../../application/ports/digistudio-gateway.port';
import { FACE_GATEWAY } from '../../../application/ports/face-gateway.port';
import { KRA_GATEWAY } from '../../../application/ports/kra-gateway.port';
import { DigioBankGateway } from './bank/bank.gateway';
import { DigiStudioGateway } from './digistudio/digistudio.gateway';
import { DigioFaceGateway } from './face/face.gateway';
import { DigioKraGateway } from './kra/kra.gateway';
import { DigioWebhookVerifier } from './webhooks/digio-webhook.verifier';

/** Digio partner adapters, available process-wide; inject by port token. */
@Global()
@Module({
  providers: [
    DigioKraGateway,
    DigioBankGateway,
    DigiStudioGateway,
    DigioFaceGateway,
    DigioWebhookVerifier,
    { provide: KRA_GATEWAY, useExisting: DigioKraGateway },
    { provide: DIGISTUDIO_GATEWAY, useExisting: DigiStudioGateway },
    { provide: FACE_GATEWAY, useExisting: DigioFaceGateway },
    { provide: BANK_GATEWAY, useExisting: DigioBankGateway },
  ],
  exports: [
    BANK_GATEWAY,
    KRA_GATEWAY,
    DIGISTUDIO_GATEWAY,
    FACE_GATEWAY,
    DigioKraGateway,
    DigioBankGateway,
    DigiStudioGateway,
    DigioFaceGateway,
    DigioWebhookVerifier,
  ],
})
export class DigioModule {}
