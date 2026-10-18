/** Screen identifiers returned as `next_screen`. Later phases append to this list. */
export const SCREENS = [
  'PHONE_ENTRY',
  'EMAIL_ENTRY',
  'ELIGIBILITY',
  'PAN_IDENTITY',
  'ASSISTED_ONBOARDING',
  'NOT_ELIGIBLE',
] as const;
export type Screen = (typeof SCREENS)[number];

export const STEP_IDS = [
  'PHONE_VERIFIED',
  'EMAIL_VERIFIED',
  'ELIGIBILITY',
] as const;
export type StepId = (typeof STEP_IDS)[number];

export const JOURNEY_VERSION = 'pms_v3';
