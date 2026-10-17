export type PrincipalKind = 'CUSTOMER' | 'PREAUTH' | 'INTERNAL' | 'REVIEWER';

export interface Principal {
  kind: PrincipalKind;
  /** Customer id, challenge id, 'internal' or reviewer id depending on kind. */
  id: string;
  applicationIds?: string[];
  challengeId?: string;
  reviewerId?: string;
}

export interface AuthenticatedRequest {
  principal?: Principal;
}
