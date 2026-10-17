import { IsInt, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ValidationError } from '../errors/app-error';
import {
  createValidationPipe,
  flattenValidationErrors,
} from './validation.pipe';

class Inner {
  @IsInt() n!: number;
}
class Dto {
  @IsString() name!: string;
  @ValidateNested() @Type(() => Inner) inner!: Inner;
}

describe('validation pipe', () => {
  const pipe = createValidationPipe();
  const meta = { type: 'body' as const, metatype: Dto, data: '' };

  it('passes valid input through as a class instance', async () => {
    const out = (await pipe.transform(
      { name: 'x', inner: { n: 1 } },
      meta,
    )) as Dto;
    expect(out).toBeInstanceOf(Dto);
  });

  it('rejects invalid and non-whitelisted input with a ValidationError carrying field details', async () => {
    const err = (await pipe
      .transform({ name: 5, extra: true, inner: { n: 'no' } }, meta)
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    const fields = (err.details as { fields: Record<string, string[]> }).fields;
    expect(Object.keys(fields).sort()).toEqual(['extra', 'inner.n', 'name']);
  });

  it('flattenValidationErrors handles nested children', () => {
    expect(
      flattenValidationErrors([
        {
          property: 'a',
          constraints: { x: 'bad' },
          children: [
            { property: 'b', constraints: { y: 'worse' }, children: [] },
          ],
        },
      ]),
    ).toEqual({ a: ['bad'], 'a.b': ['worse'] });
  });
});
