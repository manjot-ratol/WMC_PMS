import type { StepId } from './screens';

export type StepStatus = 'PENDING' | 'COMPLETE' | 'REOPENED';

export interface ApplicationStep {
  readonly stepId: StepId;
  readonly status: StepStatus;
  readonly version: number;
  readonly completedAt?: Date;
}
