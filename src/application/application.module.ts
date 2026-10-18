import { Module } from '@nestjs/common';
import { DocumentService } from './documents/document.service';
import { AdditionalVerificationService } from './kyc/additional-verification.service';
import { IdentityService } from './kyc/identity.service';
import { KycConfirmationService } from './kyc/kyc-confirmation.service';
import { KycQueryService } from './kyc/kyc-query.service';
import { KycSessionService } from './kyc/kyc-session.service';
import { KycRelianceRulebookProviders } from './rulebooks.providers';
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
    ...KycRelianceRulebookProviders,
    OtpService,
    ApplicationLifecycleService,
    PhoneChallengeService,
    EmailVerificationService,
    EligibilityService,
    ApplicationQueryService,
    IdentityService,
    KycQueryService,
    KycConfirmationService,
    KycSessionService,
    DocumentService,
    AdditionalVerificationService,
  ],
  exports: [
    PhoneChallengeService,
    EmailVerificationService,
    EligibilityService,
    ApplicationQueryService,
    IdentityService,
    KycQueryService,
    KycConfirmationService,
    KycSessionService,
    DocumentService,
    AdditionalVerificationService,
  ],
})
export class ApplicationServicesModule {}
