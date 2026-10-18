import { ValidationError } from '../../common/errors/app-error';
import type { EligibilityDecision } from '../eligibility/eligibility-engine';
import type { ApplicationStep } from './application-step';
import { JOURNEY_VERSION, type Screen, type StepId } from './screens';

export type ApplicationStatus =
  | 'IN_PROGRESS'
  | 'ASSISTED'
  | 'NOT_ELIGIBLE'
  | 'WITHDRAWN'
  | 'SUBMITTED'
  | 'ACTIVE';

export interface OnboardingApplication {
  readonly id: string;
  readonly customerId: string;
  readonly status: ApplicationStatus;
  readonly journeyVersion: string;
  readonly nextScreen: Screen;
  readonly version: number;
  readonly steps: readonly ApplicationStep[];
  readonly createdAt: Date;
}

export function newApplication(
  id: string,
  customerId: string,
  now: Date,
): OnboardingApplication {
  return {
    id,
    customerId,
    status: 'IN_PROGRESS',
    journeyVersion: JOURNEY_VERSION,
    nextScreen: 'EMAIL_ENTRY',
    version: 0,
    steps: [
      {
        stepId: 'PHONE_VERIFIED',
        status: 'COMPLETE',
        version: 1,
        completedAt: now,
      },
    ],
    createdAt: now,
  };
}

export function hasCompleted(
  app: OnboardingApplication,
  stepId: StepId,
): boolean {
  return app.steps.some((s) => s.stepId === stepId && s.status === 'COMPLETE');
}

/** Marks a step complete and advances the journey. Idempotent: completing a completed step changes nothing. */
export function completeStep(
  app: OnboardingApplication,
  stepId: StepId,
  nextScreen: Screen,
  now: Date,
): OnboardingApplication {
  const existing = app.steps.find((s) => s.stepId === stepId);
  if (existing?.status === 'COMPLETE' && app.nextScreen === nextScreen)
    return app;
  const step: ApplicationStep = {
    stepId,
    status: 'COMPLETE',
    version: (existing?.version ?? 0) + 1,
    completedAt: now,
  };
  const steps = existing
    ? app.steps.map((s) => (s.stepId === stepId ? step : s))
    : [...app.steps, step];
  return { ...app, steps, nextScreen, version: app.version + 1 };
}

export function requireStep(app: OnboardingApplication, stepId: StepId): void {
  if (!hasCompleted(app, stepId)) {
    throw new ValidationError(undefined, {
      details: { missingStep: stepId, nextScreen: app.nextScreen },
    });
  }
}

export function applyEligibility(
  app: OnboardingApplication,
  decision: EligibilityDecision,
  now: Date,
): OnboardingApplication {
  const status: ApplicationStatus =
    decision.status === 'ELIGIBLE'
      ? 'IN_PROGRESS'
      : decision.status === 'ASSISTED_REQUIRED'
        ? 'ASSISTED'
        : 'NOT_ELIGIBLE';
  const withStatus: OnboardingApplication = { ...app, status };
  const advanced = completeStep(
    withStatus,
    'ELIGIBILITY',
    decision.nextScreen,
    now,
  );
  // Re-evaluation with an unchanged outcome still records a new application version.
  return advanced === withStatus
    ? { ...withStatus, version: app.version + 1 }
    : advanced;
}
