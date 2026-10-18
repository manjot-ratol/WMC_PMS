/** Anti-abuse limits for challenge creation. Security configuration, not regulatory requirements. */
export const RATE_LIMITS = {
  phoneChallengePerPhone: {
    scope: 'phone-challenge:phone',
    limit: 5,
    windowSeconds: 900,
  },
  phoneChallengePerIp: {
    scope: 'phone-challenge:ip',
    limit: 20,
    windowSeconds: 900,
  },
  emailChallengePerApplication: {
    scope: 'email-challenge:application',
    limit: 5,
    windowSeconds: 900,
  },
} as const;
