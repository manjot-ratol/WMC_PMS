import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import {
  DigioWebhookService,
  type DigioWebhookEnvelope,
} from '../../../application/integrations/digio-webhook.service';
import { UnauthenticatedError } from '../../../common/errors/app-error';
import {
  DIGIO_CHECKSUM_HEADER,
  DigioWebhookVerifier,
} from '../../../infrastructure/partners/digio/webhooks/digio-webhook.verifier';

/** Job D: Digio webhook ingress. Body is vendor-defined; authenticated with X-Digio-Checksum over the raw body. */
@Controller('v1/integrations/digio')
export class DigioWebhookController {
  constructor(
    private readonly service: DigioWebhookService,
    private readonly verifier: DigioWebhookVerifier,
  ) {}

  @Post('webhooks')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(
    @Body() body: DigioWebhookEnvelope,
    @Headers(DIGIO_CHECKSUM_HEADER) checksum: string | undefined,
    @Req() req: { rawBody?: Buffer },
  ): Promise<{ received: true }> {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    if (!this.verifier.verify(raw, checksum)) throw new UnauthenticatedError();
    await this.service.receive(body, raw);
    return { received: true };
  }
}
