import type { MailMessage } from './mail/mail.service';

/**
 * Plain-text auth emails. Deliberately simple: OPS-1 (notifications) brings branded HTML
 * templates. Each message carries a `tag` so tests and logs can tell them apart.
 */

export function verifyEmailMessage(to: string, name: string, url: string): MailMessage {
  return {
    tag: 'verify-email',
    to,
    subject: 'Verify your Kritex email address',
    text: [
      `Hi ${name},`,
      '',
      'Confirm your email address to finish creating your Kritex account:',
      url,
      '',
      "If you didn't sign up, you can ignore this email.",
    ].join('\n'),
  };
}

export function resetPasswordMessage(to: string, name: string, url: string): MailMessage {
  return {
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
}

export type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

const OTP_SUBJECTS: Record<OtpType, string> = {
  'sign-in': 'Your Kritex sign-in code',
  'email-verification': 'Your Kritex verification code',
  'forget-password': 'Your Kritex password reset code',
  'change-email': 'Your Kritex email change code',
};

export function otpMessage(to: string, otp: string, type: OtpType): MailMessage {
  return {
    tag: `otp-${type}`,
    to,
    subject: OTP_SUBJECTS[type],
    text: [
      `Your code is ${otp}`,
      '',
      'It expires in 5 minutes. Never share this code with anyone.',
    ].join('\n'),
  };
}

export function staffInviteMessage(to: string, name: string, url: string): MailMessage {
  return {
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
}
