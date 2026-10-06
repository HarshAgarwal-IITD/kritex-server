import { GST_STATE_CODES, GSTIN_REGEX } from '../common/dto/india';

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * GSTIN check character (15th) for the first 14 characters, per the GSTN mod-36 scheme:
 * each char's index in 0-9A-Z is multiplied by 1 (odd positions) or 2 (even positions);
 * quotient and remainder of each product by 36 are summed; check = (36 - sum % 36) % 36.
 */
export function gstinCheckChar(first14: string): string {
  if (!/^[0-9A-Z]{14}$/.test(first14)) throw new RangeError('gstinCheckChar needs 14 chars 0-9A-Z');
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARSET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36];
}

export type GstinInvalidReason = 'FORMAT' | 'STATE_CODE' | 'CHECKSUM' | 'STATE_MISMATCH';

export type GstinValidation =
  | { valid: true; gstin: string; stateCode: string; pan: string }
  | { valid: false; reason: GstinInvalidReason; message: string };

/**
 * Validate a GSTIN: format (GSTIN_REGEX, after trim + upper-case), state code (first two digits
 * must be a known GST state code), check character, and optionally that it belongs to
 * `expectedStateCode`.
 */
export function validateGstin(input: string, expectedStateCode?: string | null): GstinValidation {
  const gstin = input.trim().toUpperCase();
  if (!GSTIN_REGEX.test(gstin)) {
    return { valid: false, reason: 'FORMAT', message: 'GSTIN format is invalid' };
  }
  const stateCode = gstin.slice(0, 2);
  if (!Object.hasOwn(GST_STATE_CODES, stateCode)) {
    return { valid: false, reason: 'STATE_CODE', message: `Unknown GST state code ${stateCode}` };
  }
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return { valid: false, reason: 'CHECKSUM', message: 'GSTIN check digit does not match' };
  }
  if (expectedStateCode && expectedStateCode !== stateCode) {
    return {
      valid: false,
      reason: 'STATE_MISMATCH',
      message: `GSTIN is registered in state ${stateCode}, expected ${expectedStateCode}`,
    };
  }
  return { valid: true, gstin, stateCode, pan: gstin.slice(2, 12) };
}
