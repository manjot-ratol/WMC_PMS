import type { OnboardingApplication } from '../onboarding/application';
import { hasCompleted } from '../onboarding/application';
import type { StepId } from '../onboarding/screens';
import { loadRulebook } from '../shared/rulebook-loader';

export interface ActivationRulebook {
  version: string;
  requiredSteps: StepId[];
  requireScreeningProceed: boolean;
  requireAmlProceed: boolean;
  blockingTaskCategories: string[];
  blockingRegistryStatuses: string[];
}
export const ACTIVATION_RULEBOOK = Symbol('ACTIVATION_RULEBOOK');
export const loadActivationRulebook = (file?: string): ActivationRulebook =>
  loadRulebook<ActivationRulebook>(
    'activation.v1.json',
    ['version', 'requiredSteps', 'blockingTaskCategories'],
    file,
  );

export interface ActivationInput {
  app: OnboardingApplication;
  signingStatus?: string;
  accountsReady: boolean;
  fundingStatus: string;
  screeningStatus?: string;
  amlStatus?: string;
  openTaskCategories: string[];
  registryStatuses: string[];
}
export interface Activation {
  readonly id: string;
  readonly applicationId: string;
  readonly pmsAccountId: string;
  readonly gateSnapshot: Record<string, unknown>;
  readonly activatedAt: Date;
}
export type ActivationStatus =
  'NOT_READY' | 'READY_FOR_ACTIVATION' | 'BLOCKED' | 'ACTIVE';

/** Every gate must pass in the same evaluation; the list of blockers is what the status screen reports (neutrally). */
export function evaluateActivationGates(
  input: ActivationInput,
  rulebook: ActivationRulebook,
): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  for (const s of rulebook.requiredSteps)
    if (!hasCompleted(input.app, s))
      blockers.push(`step_${s.toLowerCase()}_incomplete`);
  if (input.signingStatus !== 'EXECUTED')
    blockers.push('documents_not_executed');
  if (!input.accountsReady) blockers.push('accounts_not_ready');
  if (input.fundingStatus !== 'RECONCILED')
    blockers.push('funding_not_reconciled');
  if (rulebook.requireScreeningProceed && input.screeningStatus !== 'PROCEED')
    blockers.push('screening_pending');
  if (rulebook.requireAmlProceed && input.amlStatus !== 'PROCEED')
    blockers.push('aml_pending');
  for (const c of input.openTaskCategories)
    if (rulebook.blockingTaskCategories.includes(c))
      blockers.push(`open_task_${c.toLowerCase()}`);
  for (const r of input.registryStatuses)
    if (rulebook.blockingRegistryStatuses.includes(r))
      blockers.push(`registry_${r.toLowerCase()}`);
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)] };
}

/** Blocked means a human must act (compliance, registry, task); not-ready means something is still in flight. */
export function activationStatusFor(
  app: OnboardingApplication,
  gates: { ready: boolean; blockers: string[] },
): ActivationStatus {
  if (app.status === 'ACTIVE') return 'ACTIVE';
  if (gates.ready) return 'READY_FOR_ACTIVATION';
  const inFlight = gates.blockers.every(
    (b) =>
      b === 'funding_not_reconciled' ||
      b === 'accounts_not_ready' ||
      b === 'screening_pending' ||
      b === 'aml_pending',
  );
  return inFlight ? 'NOT_READY' : 'BLOCKED';
}
