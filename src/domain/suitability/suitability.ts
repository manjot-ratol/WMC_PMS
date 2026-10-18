import { ValidationError } from '../../common/errors/app-error';
import { loadRulebook } from '../shared/rulebook-loader';

export interface SuitabilityRulebook {
  version: string;
  questions: { id: string; answers: { id: string; score: number }[] }[];
  contradictions: {
    questionId: string;
    answerId: string;
    conflictsWith: { questionId: string; answerIds: string[] };
  }[];
  bands: {
    minScore: number;
    maxScore: number;
    riskProfile: string;
    approachCodes: string[];
  }[];
  approaches: { code: string; name: string; riskLevel: string }[];
}
export const SUITABILITY_RULEBOOK = Symbol('SUITABILITY_RULEBOOK');
export const loadSuitabilityRulebook = (file?: string): SuitabilityRulebook =>
  loadRulebook<SuitabilityRulebook>(
    'suitability.v1.json',
    ['version', 'questions', 'bands', 'approaches'],
    file,
  );

export interface Answer {
  questionId: string;
  answerId: string;
}
export type AssessmentStatus = 'COMPLETE' | 'INCOMPLETE';
export interface SuitabilityResult {
  status: AssessmentStatus;
  missingQuestionIds: string[];
  /** Present only when COMPLETE. */
  score?: number;
  riskProfile?: string;
  permittedApproachCodes: string[];
}
export interface SuitabilityAssessment extends SuitabilityResult {
  readonly id: string;
  readonly applicationId: string;
  readonly version: number;
  readonly questionnaireVersion: string;
  readonly answers: Answer[];
  readonly createdAt: Date;
}
export interface InvestmentApproach {
  readonly applicationId: string;
  readonly version: number;
  readonly assessmentId: string;
  readonly assessmentVersion: number;
  readonly approachCode: string;
  readonly confirmedAt: Date;
}

/**
 * Scores the questionnaire server-side. Unknown ids and duplicates are rejected; contradictory answers are
 * rejected with both question ids; a partial answer set is INCOMPLETE (persisted, never an approach).
 */
export function assessSuitability(
  answers: Answer[],
  rulebook: SuitabilityRulebook,
): SuitabilityResult {
  const byQuestion = new Map(rulebook.questions.map((q) => [q.id, q]));
  const seen = new Map<string, string>();
  for (const a of answers) {
    const q = byQuestion.get(a.questionId);
    if (!q)
      throw new ValidationError(undefined, {
        details: {
          field: 'answers',
          reason: 'unknown_question',
          questionId: a.questionId,
        },
      });
    if (!q.answers.some((x) => x.id === a.answerId))
      throw new ValidationError(undefined, {
        details: {
          field: 'answers',
          reason: 'unknown_answer',
          questionId: a.questionId,
        },
      });
    if (seen.has(a.questionId))
      throw new ValidationError(undefined, {
        details: {
          field: 'answers',
          reason: 'duplicate_question',
          questionId: a.questionId,
        },
      });
    seen.set(a.questionId, a.answerId);
  }
  const conflicts = rulebook.contradictions
    .filter(
      (c) =>
        seen.get(c.questionId) === c.answerId &&
        c.conflictsWith.answerIds.includes(
          seen.get(c.conflictsWith.questionId) ?? '',
        ),
    )
    .map((c) => [c.questionId, c.conflictsWith.questionId]);
  if (conflicts.length)
    throw new ValidationError(
      'Some answers contradict each other. Review them to continue.',
      {
        details: {
          reason: 'contradictory_answers',
          questionIds: [...new Set(conflicts.flat())],
        },
      },
    );
  const missingQuestionIds = rulebook.questions
    .filter((q) => !seen.has(q.id))
    .map((q) => q.id);
  if (missingQuestionIds.length)
    return {
      status: 'INCOMPLETE',
      missingQuestionIds,
      permittedApproachCodes: [],
    };
  const score = rulebook.questions.reduce(
    (sum, q) =>
      sum + (q.answers.find((x) => x.id === seen.get(q.id))?.score ?? 0),
    0,
  );
  const band = rulebook.bands.find(
    (b) => score >= b.minScore && score <= b.maxScore,
  );
  if (!band)
    throw new Error(
      `Suitability rulebook ${rulebook.version} has no band for score ${score}`,
    );
  return {
    status: 'COMPLETE',
    missingQuestionIds: [],
    score,
    riskProfile: band.riskProfile,
    permittedApproachCodes: band.approachCodes,
  };
}

/** An approach is only ever one the complete assessment permits; a mismatch needs authorised review, not a click. */
export function assertApproachPermitted(
  result: Pick<SuitabilityResult, 'status' | 'permittedApproachCodes'>,
  approachCode: string,
  rulebook: SuitabilityRulebook,
): void {
  if (!rulebook.approaches.some((a) => a.code === approachCode))
    throw new ValidationError(undefined, {
      details: { field: 'approach_code', reason: 'unknown_approach' },
    });
  if (result.status !== 'COMPLETE')
    throw new ValidationError(undefined, {
      details: { reason: 'assessment_incomplete' },
    });
  if (!result.permittedApproachCodes.includes(approachCode))
    throw new ValidationError(
      'This approach is not available for your assessed profile. Ask for help to review it.',
      {
        details: {
          reason: 'approach_not_permitted',
          permitted: result.permittedApproachCodes,
        },
      },
    );
}
