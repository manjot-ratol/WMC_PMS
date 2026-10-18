import { Module } from '@nestjs/common';
import { DigioWebhookService } from '../../../application/integrations/digio-webhook.service';
import { DigioWebhookController } from './digio-webhook.controller';

@Module({
  controllers: [DigioWebhookController],
  providers: [DigioWebhookService],
})
export class IntegrationsApiModule {}
