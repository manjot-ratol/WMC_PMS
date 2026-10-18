import { Injectable } from '@nestjs/common';
import type { Customer as Row } from '@prisma/client';
import type { CustomerRepositoryPort } from '../../../application/ports/customer.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import { Fingerprint } from '../../../common/crypto/fingerprint';
import { StaleVersionError } from '../../../common/errors/app-error';
import type { Customer } from '../../../domain/identity/customer';
import type { EmailAddress } from '../../../domain/shared/email-address';
import type { PhoneNumber } from '../../../domain/shared/phone-number';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class CustomerRepository implements CustomerRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly fingerprint: Fingerprint,
  ) {}

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<Customer | null> {
    const row = await clientOf(this.prisma, tx).customer.findUnique({
      where: { id },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByPhoneFingerprint(
    phoneFingerprint: string,
    tx?: TransactionContext,
  ): Promise<Customer | null> {
    const row = await clientOf(this.prisma, tx).customer.findUnique({
      where: { phoneFingerprint },
    });
    return row ? this.toDomain(row) : null;
  }

  async create(c: Customer, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).customer.create({
      data: { id: c.id, ...this.toColumns(c), createdAt: c.createdAt },
    });
  }

  async saveWithVersionCheck(
    c: Customer,
    expectedVersion: number,
    tx?: TransactionContext,
  ): Promise<void> {
    const result = await clientOf(this.prisma, tx).customer.updateMany({
      where: { id: c.id, version: expectedVersion },
      data: this.toColumns(c),
    });
    if (result.count !== 1)
      throw new StaleVersionError(undefined, {
        details: { aggregate: 'customer', id: c.id },
      });
  }

  private toColumns(c: Customer) {
    return {
      phoneCiphertext: bytes(this.cipher.encryptToBuffer(c.phone)),
      phoneFingerprint: this.fingerprint.of(c.phone, 'phone'),
      phoneVerifiedAt: c.phoneVerifiedAt ?? null,
      emailCiphertext: c.email
        ? bytes(this.cipher.encryptToBuffer(c.email))
        : null,
      emailFingerprint: c.email ? this.fingerprint.of(c.email, 'email') : null,
      emailVerifiedAt: c.emailVerifiedAt ?? null,
      state: c.state,
      version: c.version,
    };
  }

  private toDomain(r: Row): Customer {
    return {
      id: r.id,
      phone: this.cipher.decryptFromBuffer(
        Buffer.from(r.phoneCiphertext),
      ) as PhoneNumber,
      phoneVerifiedAt: r.phoneVerifiedAt ?? undefined,
      email: r.emailCiphertext
        ? (this.cipher.decryptFromBuffer(
            Buffer.from(r.emailCiphertext),
          ) as EmailAddress)
        : undefined,
      emailVerifiedAt: r.emailVerifiedAt ?? undefined,
      state: r.state,
      version: r.version,
      createdAt: r.createdAt,
    };
  }
}

/** Prisma's Bytes columns are typed as Uint8Array over a plain ArrayBuffer; copy out of the Buffer pool. */
function bytes(b: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(b);
}
