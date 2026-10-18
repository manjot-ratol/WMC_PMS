import { normaliseEmail } from '../../domain/shared/email-address';
import { MessageSpy } from './message-spy';
import { createSmtpTransport, SmtpEmailSender } from './smtp-email.sender';

describe('SmtpEmailSender', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  const cfg = {
    messaging: {
      from: 'no-reply@test',
      smtpHost: 'h',
      smtpPort: 1,
      timeoutMs: 1,
    },
  } as never;

  it('sends a plain-text otp mail and records to the spy, logging only the masked address', async () => {
    const sendMail = jest
      .fn<Promise<{ messageId: string }>, [Record<string, unknown>]>()
      .mockResolvedValue({ messageId: 'm1' });
    const spy = new MessageSpy();
    const sender = new SmtpEmailSender(logger as never, { sendMail }, cfg, spy);
    const res = await sender.send(normaliseEmail('customer@example.com'), {
      template: 'OTP',
      vars: { otp: '654321', expiresInMinutes: 5 },
    });
    expect(res).toEqual({ accepted: true, providerRef: 'm1' });
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: 'no-reply@test',
      to: 'customer@example.com',
    });
    expect((sendMail.mock.calls[0][0] as { text: string }).text).toContain(
      '654321',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('654321');
    expect(spy.lastFor('customer@example.com')?.otp).toBe('654321');
  });

  it('tolerates a transport response without a message id', async () => {
    const sender = new SmtpEmailSender(
      logger as never,
      { sendMail: jest.fn().mockResolvedValue({}) },
      cfg,
    );
    await expect(
      sender.send(normaliseEmail('a@example.com'), {
        template: 'OTP',
        vars: { otp: '1', expiresInMinutes: 5 },
      }),
    ).resolves.toEqual({ accepted: true, providerRef: undefined });
  });

  it('reports not accepted when the transport fails', async () => {
    const sender = new SmtpEmailSender(
      logger as never,
      { sendMail: jest.fn().mockRejectedValue(new Error('smtp down')) },
      cfg,
    );
    await expect(
      sender.send(normaliseEmail('a@example.com'), {
        template: 'OTP',
        vars: { otp: '1', expiresInMinutes: 5 },
      }),
    ).resolves.toEqual({ accepted: false });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('createSmtpTransport builds a nodemailer transport', () => {
    expect(
      createSmtpTransport({
        smtpHost: 'localhost',
        smtpPort: 1025,
        from: 'x',
        timeoutMs: 10,
      }),
    ).toBeDefined();
  });
});
