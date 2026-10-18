import { Global, Module } from '@nestjs/common';
import { BANK_GATEWAY } from '../../../application/ports/bank-gateway.port';
import { CKYC_GATEWAY } from '../../../application/ports/ckyc-gateway.port';
import { ESIGN_GATEWAY } from '../../../application/ports/esign-gateway.port';
import { DIGISTUDIO_GATEWAY } from '../../../application/ports/digistudio-gateway.port';
import { FACE_GATEWAY } from '../../../application/ports/face-gateway.port';
import { KRA_GATEWAY } from '../../../application/ports/kra-gateway.port';
import { DigioBankGateway } from './bank/bank.gateway';
import { DigioCkycGateway } from './ckyc/ckyc.gateway';
import { DigioEsignGateway } from './esign/esign.gateway';
import { DigiStudioGateway } from './digistudio/digistudio.gateway';
import { DigioFaceGateway } from './face/face.gateway';
import { DigioKraGateway } from './kra/kra.gateway';
import { DigioWebhookVerifier } from './webhooks/digio-webhook.verifier';
import { TRACKWIZZ_GATEWAY } from '../../../application/ports/trackwizz-gateway.port';
import { TrackWizzGateway } from '../trackwizz/trackwizz.gateway';

/** Digio partner adapters, available process-wide; inject by port token. */
@Global()
@Module({
  providers: [
    DigioKraGateway,
    DigioBankGateway,
    DigiStudioGateway,
    DigioFaceGateway,
    DigioWebhookVerifier,
    DigioEsignGateway,
    DigioCkycGateway,
    TrackWizzGateway,
    { provide: TRACKWIZZ_GATEWAY, useExisting: TrackWizzGateway },
    { provide: ESIGN_GATEWAY, useExisting: DigioEsignGateway },
    { provide: CKYC_GATEWAY, useExisting: DigioCkycGateway },
    { provide: KRA_GATEWAY, useExisting: DigioKraGateway },
    { provide: DIGISTUDIO_GATEWAY, useExisting: DigiStudioGateway },
    { provide: FACE_GATEWAY, useExisting: DigioFaceGateway },
    { provide: BANK_GATEWAY, useExisting: DigioBankGateway },
  ],
  exports: [
    TRACKWIZZ_GATEWAY,
    TrackWizzGateway,
    ESIGN_GATEWAY,
    CKYC_GATEWAY,
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
