import type { AppConfigService } from '../../config/app-config.service';
import { otpMessage, staffInviteMessage } from '../auth-emails';
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
    await mail.send(await staffInviteMessage('A@b.co', 'A', 'http://x/invite'));
    expect(mail.lastTo('a@b.co', 'staff-invite')?.text).toContain('http://x/invite');
    expect(sendMail).not.toHaveBeenCalled();
    mail.clearOutbox();
    expect(mail.outbox).toEqual([]);
  });

  it('sends over SMTP when SMTP_HOST is set', async () => {
    const mail = new MailService(config({ SMTP_HOST: 'localhost' }));
    await mail.send(await otpMessage('a@b.co', '123456', 'sign-in'));
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
    await mail.send(await staffInviteMessage('a@b.co', 'A', 'http://x/invite'));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('renders branded HTML next to the unchanged plain text', async () => {
    const message = await staffInviteMessage('a@b.co', 'Asha Rao', 'http://x/invite?token=1');
    expect(message.text).toContain('http://x/invite?token=1');
    expect(message.html).toContain('KRITEX');
    expect(message.html).toContain('href="http://x/invite?token=1"');
  });

  it('the verification code email says where to enter the code', async () => {
    const message = await otpMessage('a@b.co', '654321', 'email-verification');
    expect(message.subject).toBe('Your Kritex verification code');
    expect(message.text).toContain('Your code is 654321');
    expect(message.text).toMatch(/verify your email/i);
    expect(message.html).toContain('654321');
  });

  describe('Resend', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('sends through Resend when RESEND_API_KEY is set (before SMTP), with attachments', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
      global.fetch = fetchMock as typeof fetch;
      const mail = new MailService(config({ RESEND_API_KEY: 're_test', SMTP_HOST: 'localhost' }));
      await mail.send({
        ...(await otpMessage('a@b.co', '123456', 'sign-in')),
        attachments: [
          { filename: 'x.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' },
        ],
      });
      expect(sendMail).not.toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual(
        expect.objectContaining({
          from: 'Kritex <no-reply@kritex.in>',
          to: ['a@b.co'],
          subject: 'Your Kritex sign-in code',
          attachments: [
            {
              filename: 'x.pdf',
              content: Buffer.from('pdf').toString('base64'),
              content_type: 'application/pdf',
            },
          ],
        }),
      );
      expect(body.html).toContain('123456');
    });

    it('throws when Resend refuses the message', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response('{"message":"bad"}', { status: 422 })) as typeof fetch;
      const mail = new MailService(config({ RESEND_API_KEY: 're_test' }));
      await expect(mail.send(await otpMessage('a@b.co', '1', 'sign-in'))).rejects.toThrow(/422/);
    });

    it('is ignored in tests (outbox)', async () => {
      const mail = new MailService(config({ NODE_ENV: 'test', RESEND_API_KEY: 're_test' }));
      await mail.send(await otpMessage('a@b.co', '1', 'sign-in'));
      expect(mail.outbox).toHaveLength(1);
    });
  });
});
