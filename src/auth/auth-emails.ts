import { actionEmail, codeEmail } from '../notifications/templates/auth-emails';
import type { MailMessage } from './mail/mail.service';

/**
 * Auth emails: plain text plus the branded React Email HTML (OPS-1, src/notifications/templates).
 * Each message carries a `tag` so tests and logs can tell them apart.
 */

async function withHtml(
  message: MailMessage,
  html: Promise<{ html: string }>,
): Promise<MailMessage> {
  return { ...message, html: (await html).html };
}

export function resetPasswordMessage(to: string, name: string, url: string): Promise<MailMessage> {
  const message: MailMessage = {
    tag: 'reset-password',
    to,
    subject: 'Reset your Kritex password',
    text: [
      `Hi ${name},`,
      '',
      'Use this link to choose a new password (valid for 1 hour):',
      url,
      '',
      "If you didn't ask for this, you can ignore this email.",
    ].join('\n'),
  };
  return withHtml(
    message,
    actionEmail({
      subject: message.subject,
      title: 'Reset your password',
      name,
      intro: 'Use the button below to choose a new password. The link is valid for 1 hour.',
      url,
      button: 'Choose a new password',
      note: "If you didn't ask for this, you can ignore this email.",
      text: message.text,
    }),
  );
}

export type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

const OTP_SUBJECTS: Record<OtpType, string> = {
  'sign-in': 'Your Kritex sign-in code',
  'email-verification': 'Your Kritex verification code',
  'forget-password': 'Your Kritex password reset code',
  'change-email': 'Your Kritex email change code',
};

/** Shown above the code, so people know where to type it. */
const OTP_INTROS: Partial<Record<OtpType, string>> = {
  'email-verification':
    'Enter this code on the Kritex site to verify your email address. You will be signed in straight away.',
};

export function otpMessage(to: string, otp: string, type: OtpType): Promise<MailMessage> {
  const intro = OTP_INTROS[type];
  const message: MailMessage = {
    tag: `otp-${type}`,
    to,
    subject: OTP_SUBJECTS[type],
    text: [
      ...(intro ? [intro, ''] : []),
      `Your code is ${otp}`,
      '',
      'It expires in 5 minutes. Never share this code with anyone.',
    ].join('\n'),
  };
  return withHtml(
    message,
    codeEmail({ subject: message.subject, code: otp, text: message.text, intro }),
  );
}

export function staffInviteMessage(to: string, name: string, url: string): Promise<MailMessage> {
  const message: MailMessage = {
    tag: 'staff-invite',
    to,
    subject: "You've been invited to Kritex admin",
    text: [
      `Hi ${name},`,
      '',
      'An account has been created for you on the Kritex admin. Set your password here (valid for 1 hour):',
      url,
      '',
      'If the link expires, use "Forgot password" on the sign-in page.',
    ].join('\n'),
  };
  return withHtml(
    message,
    actionEmail({
      subject: message.subject,
      title: 'Welcome to the Kritex admin',
      name,
      intro:
        'An account has been created for you on the Kritex admin. Set your password to sign in (the link is valid for 1 hour).',
      url,
      button: 'Set your password',
      note: 'If the link expires, use "Forgot password" on the sign-in page.',
      text: message.text,
    }),
  );
}
