import { Code, Cta, Layout, Muted, P, renderEmail, Title } from './layout';
import type { RenderedEmail } from './layout';

/**
 * HTML versions of the auth emails. The plain-text part is passed in unchanged (tests and some
 * mail clients read it), so only the HTML is new.
 */
export function actionEmail(input: {
  subject: string;
  title: string;
  name: string;
  intro: string;
  url: string;
  button: string;
  note: string;
  text: string;
}): Promise<RenderedEmail> {
  return renderEmail(
    input.subject,
    Layout({
      preview: input.intro,
      children: [
        Title(input.title),
        P(`Hi ${input.name.split(' ')[0] || 'there'},`),
        P(input.intro),
        Cta(input.url, input.button),
        Muted('Or paste this link into your browser: ', input.url),
        Muted(input.note),
      ],
    }),
    input.text,
  );
}

export function codeEmail(input: {
  subject: string;
  code: string;
  text: string;
}): Promise<RenderedEmail> {
  return renderEmail(
    input.subject,
    Layout({
      preview: `Your code is ${input.code}`,
      children: [
        Title(input.subject),
        P('Your code is:'),
        Code(input.code),
        Muted('It expires in 5 minutes. Never share this code with anyone.'),
      ],
    }),
    input.text,
  );
}
