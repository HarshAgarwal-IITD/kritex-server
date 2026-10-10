import {
  Cta,
  Divider,
  formatDate,
  KeyValue,
  Layout,
  money,
  Muted,
  P,
  renderEmail,
  Title,
} from './layout';
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

/** Staff alert: a new quote request is waiting in /admin/quotes. */
export function staffQuoteRequestedEmail(data: {
  number: string;
  contactName: string;
  organization: string;
  email: string;
  phone: string;
  gstin: string | null;
  notes: string | null;
  items: { name: string; variant: string | null; quantity: number; notes: string | null }[];
  adminUrl: string;
}): Promise<RenderedEmail> {
  const units = data.items.reduce((n, i) => n + i.quantity, 0);
  return renderEmail(
    `New quote request ${data.number} from ${data.organization}`,
    Layout({
      preview: `${data.contactName} (${data.organization}) asked for ${data.items.length} item(s), ${units} unit(s).`,
      children: [
        Title(`New quote request ${data.number}`),
        KeyValue('Contact', data.contactName),
        KeyValue('Organisation', data.organization),
        KeyValue('Email', data.email),
        KeyValue('Phone', data.phone),
        ...(data.gstin ? [KeyValue('GSTIN', data.gstin)] : []),
        Divider(),
        ...data.items.map((i) =>
          KeyValue(
            `${i.name}${i.variant ? ` (${i.variant})` : ''}${i.notes ? ` · ${i.notes}` : ''}`,
            `× ${i.quantity}`,
          ),
        ),
        ...(data.notes ? [Divider(), P(`Notes: ${data.notes}`)] : []),
        Cta(data.adminUrl, 'Open in admin'),
        Muted(
          'Price each line in the admin and send the quote; the customer gets an email to accept it.',
        ),
      ],
    }),
  );
}

/** Staff alert: a new contact / tender enquiry (reply goes to the customer via Reply-To). */
export function staffEnquiryEmail(data: {
  name: string;
  organization: string | null;
  email: string;
  requirements: string;
  adminUrl: string;
}): Promise<RenderedEmail> {
  const who = data.organization ? `${data.name} (${data.organization})` : data.name;
  return renderEmail(
    `New enquiry from ${who}`,
    Layout({
      preview: data.requirements.slice(0, 120),
      children: [
        Title('New enquiry'),
        KeyValue('Name', data.name),
        ...(data.organization ? [KeyValue('Organisation', data.organization)] : []),
        KeyValue('Email', data.email),
        Divider(),
        P(data.requirements),
        Cta(data.adminUrl, 'Open enquiries'),
        Muted('Reply to this email to answer the customer directly.'),
      ],
    }),
  );
}
