import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MfCentralCallbackService } from '../../../application/portfolio/mfcentral-callback.service';

/**
 * Where MF Central sends the investor's browser after consent (`redirectUrl` of the CAS request). No session:
 * the browser arrives from the vendor. The payload is stored for the worker and the browser is redirected to
 * the front end; nothing about the statement is decided here.
 */
@ApiTags('integrations')
@Controller('v1/integrations/mfcentral')
export class MfCentralCallbackController {
  constructor(private readonly service: MfCentralCallbackService) {}

  @Post('callback')
  @ApiOperation({
    summary:
      "MF Central's return leg (?status=success&reqId=…&type=Summary|Detailed, or ?status=error&code=…&message=…); 302 to MFCENTRAL_RETURN_URL?import_id=…&status=awaiting_qr|declined (or status=unknown|invalid)",
  })
  @ApiResponse({ status: 302 })
  async post(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    await this.handle({ ...query, ...body }, res);
  }

  @Get('callback')
  @ApiOperation({
    summary: 'MF Central return (GET variant, same parameters in the query)',
  })
  @ApiResponse({ status: 302 })
  async get(
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    await this.handle(query, res);
  }

  private async handle(
    params: Record<string, unknown>,
    res: Response,
  ): Promise<void> {
    const r = await this.service.receive(params);
    res.redirect(302, r.redirectTo);
  }
}
