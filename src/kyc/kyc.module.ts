import { Module } from '@nestjs/common';
import { DigioModule } from '../connectors/digio/digio.module';
import { KraController } from './kra.controller';

@Module({
  imports: [DigioModule],
  controllers: [KraController],
})
export class KycModule {}
