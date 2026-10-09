import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
  toPlainText,
} from '@react-email/components';
import { createElement as h, type CSSProperties, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * React Email building blocks for every Kritex email. Templates are plain `.ts` (createElement)
 * so the build and Jest need no JSX setup. Colours follow the storefront (dark olive + green).
 */
export const brand = {
  bg: '#f3f5f4',
  card: '#ffffff',
  ink: '#0e1611',
  muted: '#5b6b62',
  primary: '#478566',
  border: '#dfe5e1',
  font: "'Geist Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace",
};

const s = {
  body: { backgroundColor: brand.bg, fontFamily: brand.font, margin: 0, padding: '24px 0' },
  container: { maxWidth: '560px', margin: '0 auto' },
  header: { backgroundColor: brand.ink, padding: '20px 28px', borderRadius: '8px 8px 0 0' },
  logo: {
    color: '#f3f5f4',
    fontFamily: brand.mono,
    fontSize: '18px',
    letterSpacing: '6px',
    margin: 0,
  },
  card: {
    backgroundColor: brand.card,
    padding: '28px',
    borderRadius: '0 0 8px 8px',
    border: `1px solid ${brand.border}`,
    borderTop: 'none',
  },
  h1: { color: brand.ink, fontSize: '22px', lineHeight: '30px', margin: '0 0 12px' },
  p: { color: brand.ink, fontSize: '15px', lineHeight: '24px', margin: '0 0 14px' },
  muted: { color: brand.muted, fontSize: '13px', lineHeight: '20px', margin: '0 0 8px' },
  button: {
    backgroundColor: brand.primary,
    color: '#ffffff',
    borderRadius: '6px',
    padding: '12px 22px',
    fontSize: '15px',
    fontWeight: 600,
    textDecoration: 'none',
    display: 'inline-block',
  },
  code: {
    fontFamily: brand.mono,
    fontSize: '28px',
    letterSpacing: '8px',
    color: brand.ink,
    margin: '8px 0 16px',
  },
  footer: { color: brand.muted, fontSize: '12px', lineHeight: '18px', textAlign: 'center' },
  hr: { borderColor: brand.border, margin: '20px 0' },
} satisfies Record<string, CSSProperties>;

export function Layout(props: { preview: string; children: ReactNode[] }) {
  return h(
    Html,
    { lang: 'en' },
    h(Head, null),
    h(Preview, null, props.preview),
    h(
      Body,
      { style: s.body },
      h(
        Container,
        { style: s.container },
        h(Section, { style: s.header }, h(Text, { style: s.logo }, 'KRITEX')),
        h(Section, { style: s.card }, ...props.children),
        h(
          Text,
          { style: { ...s.footer, marginTop: '16px' } },
          'Kritex · Tactical apparel and equipment · ',
          h(Link, { href: 'https://kritex.in', style: { color: brand.muted } }, 'kritex.in'),
        ),
      ),
    ),
  );
}

export const Title = (text: string) => h(Heading, { as: 'h1', style: s.h1 }, text);
export const P = (...children: ReactNode[]) => h(Text, { style: s.p }, ...children);
export const Muted = (...children: ReactNode[]) => h(Text, { style: s.muted }, ...children);
export const Code = (text: string) => h(Text, { style: s.code }, text);
export const Divider = () => h(Hr, { style: s.hr });
export const Cta = (href: string, label: string) =>
  h(Section, { style: { margin: '8px 0 20px' } }, h(Button, { href, style: s.button }, label));
export const A = (href: string, label: string) =>
  h(Link, { href, style: { color: brand.primary } }, label);

/** Two-column key/value row (labels left, values right), e.g. totals. */
export function KeyValue(label: string, value: string, strong = false) {
  const style: CSSProperties = {
    color: brand.ink,
    fontSize: strong ? '15px' : '14px',
    fontWeight: strong ? 700 : 400,
    margin: '2px 0',
  };
  return h(
    Row,
    null,
    h(Column, null, h(Text, { style: style }, label)),
    h(Column, { align: 'right' }, h(Text, { style: style }, value)),
  );
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
/** Paise → "₹1,299.00". */
export const money = (paise: number) => inr.format(paise / 100);

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});
export const formatDate = (date: Date | string) => dateFmt.format(new Date(date));

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders a template element to HTML + a plain-text alternative. Uses React's synchronous
 * `renderToStaticMarkup` (React Email's `render()` dynamic-imports react-dom, which Jest's CJS
 * runtime can't do); the output is what `render()` produces, minus its Suspense support.
 */
export function renderEmail(
  subject: string,
  element: ReturnType<typeof Layout>,
  text?: string,
): Promise<RenderedEmail> {
  const markup = renderToStaticMarkup(element);
  const html = `${XHTML_DOCTYPE}${markup.replace(/<!DOCTYPE.*?>/, '')}`;
  return Promise.resolve({ subject, html, text: text ?? toPlainText(html) });
}

const XHTML_DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
