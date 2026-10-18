import { normalisePhone } from '../../domain/shared/phone-number';
import { LogSmsSender } from './log-sms.sender';
import { MessageSpy } from './message-spy';

describe('LogSmsSender', () => {
  const logger = { info: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);

  it('logs a masked destination without the otp and records to the spy', async () => {
    const spy = new MessageSpy();
    const sender = new LogSmsSender(logger as never, spy);
    const res = await sender.send(normalisePhone('9000000001'), {
      template: 'OTP',
      vars: { otp: '123456', expiresInMinutes: 5 },
    });
    expect(res.accepted).toBe(true);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('123456');
    expect(JSON.stringify(logger.info.mock.calls)).toContain('+91 ******0001');
    expect(spy.lastFor('+919000000001')?.otp).toBe('123456');
    spy.clear();
    expect(spy.messages).toHaveLength(0);
  });

  it('works without a spy', async () => {
    const sender = new LogSmsSender(logger as never);
    await expect(
      sender.send(normalisePhone('9000000001'), {
        template: 'OTP',
        vars: { otp: '1', expiresInMinutes: 5 },
      }),
    ).resolves.toMatchObject({ accepted: true });
  });
});
