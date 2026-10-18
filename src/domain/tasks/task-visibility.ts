/** Task categories a customer may see on the processing screen; everything else is restricted (compliance, reviews). */
export const CUSTOMER_VISIBLE_TASK_CATEGORIES = [
  'SOURCE_OF_FUNDS_EVIDENCE',
  'FATCA_ADDITIONAL_INFO',
  'BANK_PROOF',
  'CLARIFICATION',
  'ACCOUNT_SETUP',
] as const;
/** Visible categories that need the customer to do something (as opposed to informational progress). */
export const CUSTOMER_ACTION_TASK_CATEGORIES = [
  'SOURCE_OF_FUNDS_EVIDENCE',
  'FATCA_ADDITIONAL_INFO',
  'BANK_PROOF',
  'CLARIFICATION',
] as const;

export const isCustomerVisible = (category: string): boolean =>
  (CUSTOMER_VISIBLE_TASK_CATEGORIES as readonly string[]).includes(category);
export const needsCustomerAction = (category: string): boolean =>
  (CUSTOMER_ACTION_TASK_CATEGORIES as readonly string[]).includes(category);
