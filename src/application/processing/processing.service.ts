import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { hasCompleted } from '../../domain/onboarding/application';
import type { Screen } from '../../domain/onboarding/screens';
import { ID_PREFIX } from '../../domain/shared/public-id';
import {
  isCustomerVisible,
  needsCustomerAction,
} from '../../domain/tasks/task-visibility';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../ports/document.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';

export interface ProcessingStatusView {
  applicationStatus: 'IN_PROGRESS' | 'PROCESSING' | 'ACTIVE' | 'ASSISTED';
  tasks: { taskId: string; category: string; status: string }[];
  customerActionRequired: boolean;
  nextScreen: Screen;
}
export interface TaskResponseCommand {
  applicationId: string;
  customerId: string;
  taskId: string;
  responseType: 'DOCUMENT' | 'TEXT';
  documentIds: string[];
  text?: string;
}
export const SCREEN_PROCESSING = '22';

/** Screen 22: neutral progress from the durable aggregate; restricted compliance work is never disclosed. */
@Injectable()
export class ProcessingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  async status(
    applicationId: string,
    customerId: string,
  ): Promise<ProcessingStatusView> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    const open = (await this.tasks.listOpen(app.id)).filter((t) =>
      isCustomerVisible(t.category),
    );
    const customerActionRequired = open.some(
      (t) => t.status === 'OPEN' && needsCustomerAction(t.category),
    );
    const applicationStatus =
      app.status === 'ACTIVE'
        ? 'ACTIVE'
        : app.status === 'SUBMITTED'
          ? 'PROCESSING'
          : app.status === 'ASSISTED'
            ? 'ASSISTED'
            : 'IN_PROGRESS';
    const nextScreen: Screen =
      app.status === 'ACTIVE'
        ? 'PORTFOLIO'
        : app.status === 'SUBMITTED'
          ? hasCompleted(app, 'ACCOUNT_OPENING')
            ? app.nextScreen
            : 'APPLICATION_PROCESSING'
          : app.nextScreen;
    return {
      applicationStatus,
      tasks: open.map((t) => ({
        taskId: t.id,
        category: t.category,
        status: t.status,
      })),
      customerActionRequired,
      nextScreen,
    };
  }

  async respond(
    cmd: TaskResponseCommand,
  ): Promise<{ status: 'SUBMITTED'; taskStatus: 'UNDER_REVIEW' }> {
    if (cmd.responseType === 'DOCUMENT' && !cmd.documentIds.length)
      throw new ValidationError(undefined, {
        details: { field: 'document_ids', reason: 'required' },
      });
    if (cmd.responseType === 'TEXT' && !(cmd.text ?? '').trim())
      throw new ValidationError(undefined, {
        details: { field: 'text', reason: 'required' },
      });
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
      const task = await this.tasks.findById(cmd.taskId, tx);
      if (
        !task ||
        task.applicationId !== app.id ||
        !isCustomerVisible(task.category)
      )
        throw new NotFoundError();
      if (task.status !== 'OPEN' || !needsCustomerAction(task.category))
        throw new ValidationError(undefined, {
          details: {
            reason: 'task_not_awaiting_customer',
            taskStatus: task.status,
          },
        });
      for (const docId of cmd.documentIds) {
        const doc = await this.documents.findDocument(docId, tx);
        if (!doc || doc.applicationId !== app.id)
          throw new ValidationError(undefined, {
            details: { field: 'document_ids', reason: 'unknown_document' },
          });
      }
      await this.tasks.createResponse(
        {
          id: this.ids.prefixed(ID_PREFIX.taskResponse),
          taskId: task.id,
          applicationId: app.id,
          responseType: cmd.responseType,
          documentIds: cmd.documentIds,
          text: cmd.text?.trim() || undefined,
          submittedAt: now,
        },
        tx,
      );
      await this.tasks.update({ ...task, status: 'UNDER_REVIEW' }, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'task.responded',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            taskId: task.id,
            category: task.category,
            responseType: cmd.responseType,
            documentCount: cmd.documentIds.length,
          },
        },
        tx,
      );
      return { status: 'SUBMITTED', taskStatus: 'UNDER_REVIEW' };
    });
  }
}
