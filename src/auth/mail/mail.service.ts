import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { ResendTransport } from './resend.transport';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  /** Short machine-readable kind, e.g. `verify-email`. Used for logs and tests. */
  tag: string;
}

/**
 * The one outgoing-mail interface (auth emails and NotificationsModule). Transport, first match:
 *
 * - `NODE_ENV=test`: messages are kept in memory (`outbox`) and nothing is sent.
 * - `RESEND_API_KEY` set: sent through Resend (OPS-1).
 * - `SMTP_HOST` set: sent over SMTP (dev: Mailpit, `SMTP_HOST=localhost SMTP_PORT=1025`).
 * - Otherwise (dev): logged to the console, including the links / codes, so flows can be tested.
 *
 * `send()` throws when the provider refuses the message; callers decide whether that matters.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transporter: Transporter | null;
  private readonly resend: ResendTransport | null;
  private readonly from: string;
  private readonly logContents: boolean;
  private readonly keepInMemory: boolean;
  /** Messages sent so far (test env only). */
  readonly outbox: MailMessage[] = [];

  constructor(config: AppConfigService) {
    const env = config.get('NODE_ENV');
    const host = config.get('SMTP_HOST');
    this.from = config.get('MAIL_FROM');
    this.keepInMemory = env === 'test';
    // Never print links/codes outside development.
    this.logContents = env === 'development';
    const user = config.get('SMTP_USER');
    const resendKey = config.get('RESEND_API_KEY');
    this.resend =
      resendKey && !this.keepInMemory ? new ResendTransport(resendKey, this.from) : null;
    this.transporter =
      host && !this.keepInMemory && !this.resend
        ? createTransport({
            host,
            port: config.get('SMTP_PORT'),
            secure: config.get('SMTP_SECURE'),
            auth: user ? { user, pass: config.get('SMTP_PASS') ?? '' } : undefined,
          })
        : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.keepInMemory) {
      this.outbox.push(message);
      return;
    }
    if (this.logContents) {
      this.logger.log(
        `[${message.tag}] to=${message.to} subject="${message.subject}"\n${message.text}`,
      );
    } else {
      this.logger.log(`[${message.tag}] sending "${message.subject}"`);
    }
    if (this.resend) {
      await this.resend.send(message);
    } else if (this.transporter) {
      const { tag: _tag, ...mail } = message;
      await this.transporter.sendMail({ from: this.from, ...mail });
    } else if (!this.logContents) {
      this.logger.warn(`No mail transport configured: "${message.tag}" email was not delivered`);
    }
  }

  /** Test helper: the most recent message to `to` (optionally of a given tag). */
  lastTo(to: string, tag?: string): MailMessage | undefined {
    return [...this.outbox]
      .reverse()
      .find((m) => m.to.toLowerCase() === to.toLowerCase() && (!tag || m.tag === tag));
  }

  clearOutbox(): void {
    this.outbox.length = 0;
  }
}
