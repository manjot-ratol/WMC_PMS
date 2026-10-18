import type { PortfolioSnapshotData } from '../../domain/portfolio/cas-parser';
import type { PortfolioImport } from '../../domain/portfolio/portfolio-import';
import type { TransactionContext } from './unit-of-work.port';

export interface PortfolioSnapshot {
  id: string;
  importId: string;
  applicationId: string;
  data: PortfolioSnapshotData;
  /** Object-storage key of the decrypted vendor statement kept as restricted evidence. */
  evidenceKey: string;
  createdAt: Date;
}

export interface PortfolioRepositoryPort {
  createImport(imp: PortfolioImport, tx?: TransactionContext): Promise<void>;
  updateImport(imp: PortfolioImport, tx?: TransactionContext): Promise<void>;
  findImport(
    id: string,
    tx?: TransactionContext,
  ): Promise<PortfolioImport | null>;
  findImportByClientRef(
    clientRefNo: string,
    tx?: TransactionContext,
  ): Promise<PortfolioImport | null>;
  latestImport(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<PortfolioImport | null>;
  /** Insert-if-new on `importId`; returns false when a snapshot already exists (replayed callback). */
  createSnapshot(
    s: PortfolioSnapshot,
    tx?: TransactionContext,
  ): Promise<boolean>;
  latestSnapshot(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<PortfolioSnapshot | null>;
}
export const PORTFOLIO_REPOSITORY = Symbol('PORTFOLIO_REPOSITORY');
