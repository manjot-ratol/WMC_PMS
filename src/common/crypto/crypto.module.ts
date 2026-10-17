import { Global, Module } from '@nestjs/common';
import { FieldCipher } from './field-cipher';
import { Fingerprint } from './fingerprint';

@Global()
@Module({
  providers: [FieldCipher, Fingerprint],
  exports: [FieldCipher, Fingerprint],
})
export class CryptoModule {}
