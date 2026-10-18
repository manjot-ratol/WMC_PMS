export const QUEUES = {
  OUTBOX: 'outbox-dispatch',
  ANALYTICS: 'analytics-dispatch',
  IDENTITY: 'identity-verification',
  IPV: 'ipv-verification',
  KYC_STATUS: 'kyc-status',
  DOCUMENTS: 'document-processing',
  BANK: 'bank-verification',
  SCREENING: 'screening',
  AML: 'aml-assessment',
  ACCOUNT_OPENING: 'account-opening',
  WEBHOOKS: 'webhook-processing',
  ACTIVATION: 'activation',
  SIGNING: 'signing-status',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);
