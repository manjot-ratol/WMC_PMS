import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { maskAccount } from '../../domain/bank/bank-account';
import {
  DOCUMENT_PACK_RULEBOOK,
  type DocumentPackRulebook,
} from '../../domain/documents/document-pack';
import {
  completeStep,
  hasCompleted,
  requireStep,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import type { StepId } from '../../domain/onboarding/screens';
import {
  hashSections,
  maskPan,
  type ReviewSections,
} from '../../domain/review/review-snapshot';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import {
  BANK_REPOSITORY,
  type BankRepositoryPort,
} from '../ports/bank.repository.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  ELIGIBILITY_REPOSITORY,
  type EligibilityRepositoryPort,
} from '../ports/eligibility.repository.port';
import {
  FEE_REPOSITORY,
  type FeeRepositoryPort,
} from '../ports/fee.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';
import {
  NOMINATION_REPOSITORY,
  type NominationRepositoryPort,
} from '../ports/nomination.repository.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  DECLARATIONS_REPOSITORY,
  PROFILE_REPOSITORY,
  type DeclarationsRepositoryPort,
  type ProfileRepositoryPort,
} from '../ports/profile.repository.port';
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
} from '../ports/review.repository.port';
import {
  SUITABILITY_REPOSITORY,
  type SuitabilityRepositoryPort,
} from '../ports/suitability.repository.port';
import {
  UNIT_OF_WORK,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';

export interface ReviewSummary {
  applicationVersion: number;
  documentPackVersion: number;
  ready: boolean;
  blockers: string[];
  sections: ReviewSections;
}
export interface ConfirmReviewCommand {
  applicationId: string;
  customerId: string;
  applicationVersion: number;
  documentPackVersion: number;
  detailsConfirmed: boolean;
}
export const SCREEN_REVIEW = '20';
/** Customer-owed evidence that a review confirmation must not hide. */
export const REVIEW_BLOCKING_TASK_CATEGORIES = [
  'SOURCE_OF_FUNDS_EVIDENCE',
  'FATCA_ADDITIONAL_INFO',
  'BANK_NAME_REVIEW',
] as const;
const REQUIRED_STEPS: StepId[] = [
  'NOMINATION',
  'SUITABILITY',
  'APPROACH',
  'ACKNOWLEDGEMENTS',
];

/** Screen 20: masked summary of everything confirmed so far and the immutable snapshot signing executes against. */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(ELIGIBILITY_REPOSITORY)
    private readonly eligibility: EligibilityRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kyc: KycRecordRepositoryPort,
    @Inject(PROFILE_REPOSITORY)
    private readonly profiles: ProfileRepositoryPort,
    @Inject(DECLARATIONS_REPOSITORY)
    private readonly declarations: DeclarationsRepositoryPort,
    @Inject(BANK_REPOSITORY) private readonly bank: BankRepositoryPort,
    @Inject(NOMINATION_REPOSITORY)
    private readonly nominations: NominationRepositoryPort,
    @Inject(SUITABILITY_REPOSITORY)
    private readonly suitability: SuitabilityRepositoryPort,
    @Inject(FEE_REPOSITORY) private readonly fees: FeeRepositoryPort,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(DOCUMENT_PACK_RULEBOOK) private readonly pack: DocumentPackRulebook,
  ) {}

  async get(applicationId: string, customerId: string): Promise<ReviewSummary> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    requireStep(app, 'ACKNOWLEDGEMENTS');
    const { sections, blockers } = await this.assemble(app);
    return {
      applicationVersion: app.version,
      documentPackVersion: this.pack.packVersion,
      ready: blockers.length === 0,
      blockers,
      sections,
    };
  }

  async confirm(cmd: ConfirmReviewCommand): Promise<{
    status: 'CONFIRMED';
    snapshotId: string;
    nextScreen: 'SIGN_DOCUMENTS';
  }> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
      if (app.status !== 'IN_PROGRESS')
        throw new ValidationError(undefined, {
          details: { applicationStatus: app.status },
        });
      if (cmd.applicationVersion !== app.version)
        throw new StaleVersionError(undefined, {
          details: { currentApplicationVersion: app.version },
        });
      if (cmd.documentPackVersion !== this.pack.packVersion)
        throw new StaleVersionError(undefined, {
          details: { currentDocumentPackVersion: this.pack.packVersion },
        });
      if (cmd.detailsConfirmed !== true)
        throw new ValidationError(undefined, {
          details: {
            field: 'details_confirmed',
            reason: 'confirmation_required',
          },
        });
      const { sections, blockers } = await this.assemble(app, tx);
      if (blockers.length)
        throw new ValidationError(undefined, {
          details: { reason: blockers[0], blockers },
        });

      const advanced = completeStep(app, 'REVIEW', 'SIGN_DOCUMENTS', now);
      await this.applications.saveWithVersionCheck(advanced, app.version, tx);
      await this.reviews.supersedeCurrent(app.id, tx);
      const id = this.ids.prefixed(ID_PREFIX.reviewSnapshot);
      await this.reviews.create(
        {
          id,
          applicationId: app.id,
          confirmedApplicationVersion: app.version,
          applicationVersion: advanced.version,
          documentPackVersion: this.pack.packVersion,
          sections,
          hash: hashSections(sections),
          status: 'CURRENT',
          confirmedAt: now,
        },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'review.confirmed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            snapshotId: id,
            confirmedApplicationVersion: app.version,
            documentPackVersion: this.pack.packVersion,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'REVIEW' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Application Review Confirmed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_REVIEW,
          outcome: 'confirmed',
        },
        tx,
      );
      return {
        status: 'CONFIRMED',
        snapshotId: id,
        nextScreen: 'SIGN_DOCUMENTS',
      };
    });
  }

  /** Masked sections plus every gate a confirmation must pass. Missing sections surface as blockers, never as crashes. */
  private async assemble(
    app: OnboardingApplication,
    tx?: TransactionContext,
  ): Promise<{ sections: ReviewSections; blockers: string[] }> {
    const blockers = REQUIRED_STEPS.filter((s) => !hasCompleted(app, s)).map(
      (s) => `step_${s.toLowerCase()}_incomplete`,
    );
    const [
      eligibility,
      identity,
      kyc,
      profile,
      declarations,
      verification,
      nomination,
      assessment,
      approach,
      acknowledgement,
      openTasks,
    ] = await Promise.all([
      this.eligibility.latest(app.id, tx),
      this.identities.latest(app.id, tx),
      this.kyc.latestForApplication(app.id, tx),
      this.profiles.latest(app.id, tx),
      this.declarations.latest(app.id, tx),
      this.bank.latestVerification(app.id, tx),
      this.nominations.latest(app.id, tx),
      this.suitability.latestAssessment(app.id, tx),
      this.suitability.latestApproach(app.id, tx),
      this.fees.latestAcknowledgement(app.id, tx),
      this.tasks.listOpen(app.id, tx),
    ]);
    const account = verification
      ? await this.bank.findAccount(verification.bankAccountId, tx)
      : null;
    const missing = Object.entries({
      eligibility,
      identity,
      kyc,
      profile,
      declarations,
      verification,
      account,
      nomination,
      assessment,
      approach,
      acknowledgement,
    })
      .filter(([, v]) => !v)
      .map(([k]) => `section_${k}_missing`);
    if (missing.length)
      throw new ValidationError(undefined, {
        details: { reason: missing[0], blockers: [...blockers, ...missing] },
      });
    if (verification!.status !== 'VERIFIED') blockers.push('bank_not_verified');
    if (
      approach!.assessmentVersion !== assessment!.version ||
      assessment!.status !== 'COMPLETE'
    )
      blockers.push('approach_reconfirmation_required');
    if (acknowledgement!.documentPackVersion !== this.pack.packVersion)
      blockers.push('acknowledgements_outdated');
    const blocking = openTasks.filter((t) =>
      (REVIEW_BLOCKING_TASK_CATEGORIES as readonly string[]).includes(
        t.category,
      ),
    );
    if (blocking.length)
      blockers.push(
        ...blocking.map((t) => `open_task_${t.category.toLowerCase()}`),
      );
    const sections: ReviewSections = {
      eligibility: {
        version: eligibility!.version,
        intendedInvestmentInr: eligibility!.input.intendedInvestmentInr,
        journeyRoute: eligibility!.journeyRoute,
      },
      identity: {
        version: identity!.version,
        legalName: identity!.legalName,
        panMasked: maskPan(identity!.pan),
        dateOfBirth: identity!.dateOfBirth,
      },
      kyc: { version: kyc!.version, status: kyc!.status, route: kyc!.route },
      profile: {
        version: profile!.version,
        occupation: profile!.occupation,
        annualIncomeBand: profile!.annualIncomeBand,
        sourceOfFunds: profile!.sourceOfFunds,
      },
      declarations: {
        version: declarations!.version,
        taxResidencyCountries: declarations!.taxResidencies.map(
          (t) => t.country,
        ),
        pepDeclaration: declarations!.pepDeclaration,
        declarationVersion: declarations!.declarationVersion,
      },
      bank: {
        verificationId: verification!.id,
        accountMasked: maskAccount(account!.accountNumber),
        ifsc: account!.ifsc,
        holderName: account!.holderName,
      },
      nomination: {
        version: nomination!.version,
        choice: nomination!.choice,
        nomineeCount: nomination!.nominees.length,
      },
      suitability: {
        assessmentId: assessment!.id,
        version: assessment!.version,
        riskProfile: assessment!.riskProfile,
        questionnaireVersion: assessment!.questionnaireVersion,
      },
      approach: {
        version: approach!.version,
        approachCode: approach!.approachCode,
        assessmentVersion: approach!.assessmentVersion,
      },
      acknowledgements: {
        version: acknowledgement!.version,
        documentPackVersion: acknowledgement!.documentPackVersion,
        documents: acknowledgement!.items,
      },
    };
    return { sections, blockers: [...new Set(blockers)] };
  }
}
