import { z } from 'zod';

/**
 * GST state codes (first two digits of a GSTIN). Used as `stateCode` on addresses so the tax
 * module can compare the place of supply with the seller's state (CGST+SGST vs IGST, ADR-006).
 */
export const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
} as const satisfies Record<string, string>;

export type GstStateCode = keyof typeof GST_STATE_CODES;

export const stateCodeSchema = z
  .enum(Object.keys(GST_STATE_CODES) as [GstStateCode, ...GstStateCode[]])
  .meta({ description: 'Two-digit GST state code, e.g. "27" (Maharashtra)' });

/** 6-digit Indian PIN code (first digit 1-9). */
export const PINCODE_REGEX = /^[1-9]\d{5}$/;
export const pincodeSchema = z
  .string()
  .trim()
  .regex(PINCODE_REGEX, 'Invalid PIN code')
  .meta({ example: '400001' });

/** Indian mobile number: 10 digits starting 6-9, optionally prefixed with +91. No spaces. */
export const PHONE_REGEX = /^(?:\+91)?[6-9]\d{9}$/;
export const phoneSchema = z
  .string()
  .trim()
  .regex(PHONE_REGEX, 'Invalid Indian mobile number')
  .meta({ example: '+919876543210' });

/**
 * GSTIN: 2-digit state code + 10-char PAN + entity number + 'Z' + checksum char.
 * Input is trimmed and upper-cased. (Checksum + state-code match are checked by TaxService.)
 */
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_REGEX, 'Invalid GSTIN')
  .meta({ example: '27AAPFU0939F1ZV' });

/** Email input: trimmed + lower-cased (`.email()` after `.trim()`, see CLAUDE.md gotchas). */
export const emailInputSchema = z.string().trim().toLowerCase().max(200).email();
