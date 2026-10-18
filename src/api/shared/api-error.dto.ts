import { ApiProperty } from '@nestjs/swagger';

class ApiErrorBody {
  @ApiProperty({ example: 'ACTION_REQUIRED' }) code!: string;
  @ApiProperty({ example: 'Complete the required information to continue.' })
  message!: string;
  @ApiProperty({ example: false }) retryable!: boolean;
}

/** Documented shape of every non-2xx response. */
export class ApiErrorDto {
  @ApiProperty({ type: ApiErrorBody }) error!: ApiErrorBody;
  @ApiProperty({ example: '0f3b9d2e-7c1a-4a6e-9f3c-1b2a3c4d5e6f' })
  request_id!: string;
}
