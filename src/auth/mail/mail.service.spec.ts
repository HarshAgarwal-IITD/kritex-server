import type { AppConfigService } from '../../config/app-config.service';
import { otpMessage, staffInviteMessage, verifyEmailMessage } from '../auth-emails';
import { MailService } from './mail.service';

const sendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail })) }));

const config = (env: Record<string, unknown>) =>
  ({
    get: (key: string) =>
      ({
        NODE_ENV: 'development',
        MAIL_FROM: 'Kritex <no-reply@kritex.in>',
        SMTP_PORT: 1025,
        ...env,
      })[key],
  }) as unknown as AppConfigService;

describe('MailService', () => {
  beforeEach(() => sendMail.mockClear());

  it('keeps messages in memory in tests', async () => {
    const mail = new MailService(config({ NODE_ENV: 'test', SMTP_HOST: 'localhost' }));
    await mail.send(verifyEmailMessage('A@b.co', 'A', 'http://x/verify'));
    expect(mail.lastTo('a@b.co', 'verify-email')?.text).toContain('http://x/verify');
    expect(sendMail).not.toHaveBeenCalled();
    mail.clearOutbox();
    expect(mail.outbox).toEqual([]);
  });

  it('sends over SMTP when SMTP_HOST is set', async () => {
    const mail = new MailService(config({ SMTP_HOST: 'localhost' }));
    await mail.send(otpMessage('a@b.co', '123456', 'sign-in'));
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Kritex <no-reply@kritex.in>',
        to: 'a@b.co',
        subject: 'Your Kritex sign-in code',
        text: expect.stringContaining('123456'),
      }),
    );
  });

  it('only logs without SMTP_HOST', async () => {
    const mail = new MailService(config({}));
    await mail.send(staffInviteMessage('a@b.co', 'A', 'http://x/invite'));
    expect(sendMail).not.toHaveBeenCalled();
  });
});
