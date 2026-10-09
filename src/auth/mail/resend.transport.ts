import type { MailMessage } from './mail.service';

export class MailDeliveryError extends Error {}

/**
 * Resend (https://resend.com/docs/api-reference/emails/send-email) over plain `fetch`, so no SDK.
 * Throws `MailDeliveryError` on a non-2xx answer; returns the Resend email id.
 */
export class ResendTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = 'https://api.resend.com/emails',
  ) {}

  async send(message: MailMessage): Promise<string | null> {
    const body = {
      from: this.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString('base64'),
              content_type: a.contentType,
            })),
          }
        : {}),
      tags: [{ name: 'kind', value: message.tag.replace(/[^A-Za-z0-9_-]/g, '_') }],
    };
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MailDeliveryError(`Resend ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
      return (JSON.parse(text) as { id?: string }).id ?? null;
    } catch {
      return null;
    }
  }
}
