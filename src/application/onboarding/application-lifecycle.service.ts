import { Inject, Injectable } from '@nestjs/common';
import {
  newApplication,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import type { TransactionContext } from '../ports/unit-of-work.port';

/** One in-progress application per customer: resume it if it exists, otherwise create it. */
@Injectable()
export class ApplicationLifecycleService {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  async createOrResume(
    customerId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<{ application: OnboardingApplication; created: boolean }> {
    const existing = await this.applications.findInProgressByCustomer(
      customerId,
      tx,
    );
    if (existing) return { application: existing, created: false };
    const application = newApplication(
      this.ids.prefixed(ID_PREFIX.application),
      customerId,
      now,
    );
    await this.applications.create(application, tx);
    return { application, created: true };
  }
}
