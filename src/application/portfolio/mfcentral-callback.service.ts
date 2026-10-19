import { Inject, Injectable } from '@nestjs/common';
import { partnersConfig } from '../../common/config/partners.config';
import { AppLogger } from '../../common/logging/logger.service';
import { evaluateReturn } from '../../domain/portfolio/portfolio-import';
import { PortfolioImportService } from './portfolio-import.service';

/**
 * Where MF Central's consent page sends the browser back (`redirectUrl`). It only carries a status and their
 * `reqId`, never the statement: we record the outcome and send the browser on to the front end.
 */
@Injectable()
export class MfCentralCallbackService {
  private readonly logger: AppLogger;
  constructor(
    private readonly imports: PortfolioImportService,
    @Inject(partnersConfig.KEY)
    private readonly partners: ReturnType<typeof partnersConfig>,
    logger: AppLogger,
  ) {
    this.logger = logger.child('MfCentralCallbackService');
  }

  async receive(
    params: Record<string, unknown>,
  ): Promise<{ redirectTo: string; importId?: string }> {
    const evaluation = evaluateReturn(params);
    const result = await this.imports.markReturned(evaluation);
    if (!result.importId) {
      this.logger.warn('mfcentral.return.unknown', {
        outcome: evaluation.outcome,
      });
      return {
        redirectTo: this.returnUrl({
          status: evaluation.outcome === 'INVALID' ? 'invalid' : 'unknown',
        }),
      };
    }
    return {
      redirectTo: this.returnUrl({
        import_id: result.importId,
        status: (result.status ?? 'unknown').toLowerCase(),
      }),
      importId: result.importId,
    };
  }

  private returnUrl(query: Record<string, string>): string {
    const u = new URL(this.partners.mfcentral.returnUrl);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }
}
