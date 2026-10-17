import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import type { ValidationError as ClassValidationError } from 'class-validator';
import { ValidationError } from '../errors/app-error';

/** Flattens class-validator output into {field: [messages]} for the error envelope details. */
export function flattenValidationErrors(
  errors: ClassValidationError[],
  parent = '',
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    if (e.children?.length)
      Object.assign(out, flattenValidationErrors(e.children, path));
  }
  return out;
}

export const validationPipeOptions: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  exceptionFactory: (errors) =>
    new ValidationError(undefined, {
      details: { fields: flattenValidationErrors(errors) },
    }),
};

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe(validationPipeOptions);
}
