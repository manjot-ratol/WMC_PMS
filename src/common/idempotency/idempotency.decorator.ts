import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/** Marks a mutating handler as requiring an Idempotency-Key header. */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
