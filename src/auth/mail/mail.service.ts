import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Short machine-readable kind, e.g. `verify-email`. Used for logs and tests. */
  tag: string;
}

/**
 * Minimal outgoing-mail interface for auth emails (AUTH-4). OPS-1 replaces the transport with the
 * real provider (Resend/SES) behind the same `send()`.
 *
 * - `NODE_ENV=test`: messages are kept in memory (`outbox`) and nothing is sent.
 * - `SMTP_HOST` set: sent over SMTP (dev: Mailpit, `SMTP_HOST=localhost SMTP_PORT=1025`).
 * - Otherwise (dev): logged to the console, including the links / codes, so flows can be tested.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transporter: Transporter | null;
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
    this.transporter =
      host && !this.keepInMemory
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
    if (this.transporter) {
      await this.transporter.sendMail({ from: this.from, ...message });
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
