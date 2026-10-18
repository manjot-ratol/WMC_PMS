import { Module } from '@nestjs/common';
import {
  ELIGIBILITY_RULEBOOK,
  loadEligibilityRulebook,
} from '../domain/eligibility/eligibility-rulebook';
import { MessagingModule } from '../infrastructure/messaging/messaging.module';
import { OtpService } from './auth/otp.service';
import { PhoneChallengeService } from './auth/phone-challenge.service';
import { ApplicationLifecycleService } from './onboarding/application-lifecycle.service';
import { ApplicationQueryService } from './onboarding/application-query.service';
import { EligibilityService } from './onboarding/eligibility.service';
import { EmailVerificationService } from './onboarding/email-verification.service';

/** Use-case services. Infrastructure ports come from the global platform modules. */
@Module({
  imports: [MessagingModule],
  providers: [
    {
      provide: ELIGIBILITY_RULEBOOK,
      useFactory: () => loadEligibilityRulebook(),
    },
    OtpService,
    ApplicationLifecycleService,
    PhoneChallengeService,
    EmailVerificationService,
    EligibilityService,
    ApplicationQueryService,
  ],
  exports: [
    PhoneChallengeService,
    EmailVerificationService,
    EligibilityService,
    ApplicationQueryService,
  ],
})
export class ApplicationServicesModule {}
