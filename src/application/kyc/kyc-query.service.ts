import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  kycNextScreen,
  type KycRoute,
  type KycStatus,
} from '../../domain/kyc/kyc-record';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';

export interface KycView {
  status: KycStatus;
  route?: KycRoute;
  operationId: string;
  recordVersion: number;
  nextScreen: string;
  /** Customer-safe prefill for screen 08. */
  details?: {
    legalName?: string;
    address?: {
      line1?: string;
      line2?: string;
      line3?: string;
      city?: string;
      pinCode?: string;
    };
  };
}

/** Screen 07: read-only. Polling never triggers a provider call. */
@Injectable()
export class KycQueryService {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
  ) {}

  async get(applicationId: string, customerId: string): Promise<KycView> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    const record = await this.kycRecords.latestForApplication(applicationId);
    if (!record)
      throw new ValidationError(undefined, {
        details: { missingStep: 'IDENTITY', nextScreen: app.nextScreen },
      });
    const showDetails =
      record.status === 'EXISTING_RECORD_AVAILABLE' && record.route === 'REUSE';
    return {
      status: record.status,
      route: record.route,
      operationId: record.operationId,
      recordVersion: record.version,
      nextScreen: kycNextScreen(record),
      details:
        showDetails && record.summary
          ? {
              legalName: record.summary.name,
              address: record.summary.correspondenceAddress,
            }
          : undefined,
    };
  }
}
