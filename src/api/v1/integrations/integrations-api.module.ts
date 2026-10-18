import { Module } from '@nestjs/common';
import { ApplicationServicesModule } from '../../../application/application.module';
import { DigioWebhookService } from '../../../application/integrations/digio-webhook.service';
import { DigioWebhookController } from './digio-webhook.controller';
import { MfCentralCallbackController } from './mfcentral-callback.controller';

@Module({
  imports: [ApplicationServicesModule],
  controllers: [DigioWebhookController, MfCentralCallbackController],
  providers: [DigioWebhookService],
})
export class IntegrationsApiModule {}
