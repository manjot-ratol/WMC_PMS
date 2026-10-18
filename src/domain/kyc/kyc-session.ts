export type KycSessionStatus =
  | 'REQUESTED'
  | 'IN_PROGRESS'
  | 'APPROVAL_PENDING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface KycSession {
  readonly id: string;
  readonly applicationId: string;
  readonly provider: 'DIGIO';
  readonly providerRequestId?: string;
  readonly templateName: string;
  readonly status: KycSessionStatus;
  readonly lastProviderStatus?: string;
  readonly pollCount: number;
  readonly safeErrorCategory?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export interface ProviderAction {
  id?: string;
  type?: string;
  status?: string;
  optional?: boolean;
  processingDone?: boolean;
  validationResult?: unknown;
  faceMatchStatus?: string;
}

export interface ProviderStatusView {
  requestStatus: string;
  actions: ProviderAction[];
}

export type SessionEvaluation =
  | { outcome: 'IN_PROGRESS' }
  | { outcome: 'COMPLETED' }
  | { outcome: 'APPROVAL_PENDING' }
  | {
      outcome: 'TERMINAL';
      status: 'REJECTED' | 'FAILED' | 'EXPIRED';
      category: string;
    };

/**
 * A DigiStudio request completes only when it is approved and every mandatory action succeeded with
 * processing finished. `requested` is never completion; `skipped` counts only for optional actions.
 */
export function evaluateProviderStatus(
  view: ProviderStatusView,
): SessionEvaluation {
  switch (view.requestStatus) {
    case 'rejected':
      return {
        outcome: 'TERMINAL',
        status: 'REJECTED',
        category: 'provider_rejected',
      };
    case 'failed':
      return {
        outcome: 'TERMINAL',
        status: 'FAILED',
        category: 'provider_failed',
      };
    case 'expired':
      return {
        outcome: 'TERMINAL',
        status: 'EXPIRED',
        category: 'provider_expired',
      };
    case 'approval_pending':
      return { outcome: 'APPROVAL_PENDING' };
    case 'approved': {
      const mandatoryOk = view.actions.every(
        (a) =>
          a.optional === true ||
          (['success', 'approved'].includes(a.status ?? '') &&
            a.processingDone !== false),
      );
      return mandatoryOk
        ? { outcome: 'COMPLETED' }
        : { outcome: 'APPROVAL_PENDING' };
    }
    default:
      return { outcome: 'IN_PROGRESS' };
  }
}
