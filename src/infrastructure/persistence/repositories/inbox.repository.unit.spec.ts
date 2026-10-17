import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { InboxRepository } from './inbox.repository';

describe('InboxRepository (unit)', () => {
  it('rethrows errors that are not unique-violations', async () => {
    const prisma = {
      integrationInbox: {
        create: jest.fn().mockRejectedValue(new Error('connection lost')),
      },
    };
    const repo = new InboxRepository(prisma as never, new CorrelationStore());
    await expect(repo.insertIfNew('digio', 'k', {})).rejects.toThrow(
      'connection lost',
    );
  });
});
