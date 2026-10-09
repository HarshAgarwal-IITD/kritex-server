import { Cta, formatDate, KeyValue, Layout, money, Muted, P, renderEmail, Title } from './layout';
import type { RenderedEmail } from './layout';

export function quoteRespondedEmail(data: {
  number: string;
  contactName: string;
  organization: string;
  quotedTotal: number;
  validUntil: string;
  quoteUrl: string;
}): Promise<RenderedEmail> {
  return renderEmail(
    `Your Kritex quote ${data.number} is ready`,
    Layout({
      preview: `We've priced your request ${data.number}: ${money(data.quotedTotal)}.`,
      children: [
        Title('Your quote is ready'),
        P(`Hi ${data.contactName.split(' ')[0] || 'there'},`),
        P(
          `We've reviewed your request ${data.number}${
            data.organization ? ` for ${data.organization}` : ''
          } and priced every item.`,
        ),
        KeyValue('Quoted total (incl. GST, before shipping)', money(data.quotedTotal), true),
        KeyValue('Valid until', formatDate(data.validUntil)),
        Cta(data.quoteUrl, 'Review and accept'),
        Muted(
          'Sign in with this email address to see the line-by-line prices and accept the quote.',
        ),
      ],
    }),
  );
}
