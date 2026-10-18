import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/errors/app-error';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';

export interface ApplicationSummary {
  applicationId: string;
  status: string;
  nextScreen: string;
  version: number;
  journeyVersion: string;
  steps: { stepId: string; status: string; completedAt?: Date }[];
}

/** Side-effect-free read used to resume the journey. */
@Injectable()
export class ApplicationQueryService {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
  ) {}

  async get(
    applicationId: string,
    customerId: string,
  ): Promise<ApplicationSummary> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    return {
      applicationId: app.id,
      status: app.status,
      nextScreen: app.nextScreen,
      version: app.version,
      journeyVersion: app.journeyVersion,
      steps: app.steps.map((s) => ({
        stepId: s.stepId,
        status: s.status,
        completedAt: s.completedAt,
      })),
    };
  }
}
