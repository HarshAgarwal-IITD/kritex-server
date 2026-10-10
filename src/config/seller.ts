/**
 * The business behind Kritex (owner, 2026-10-11): printed on GST invoices and used for the GST
 * place-of-supply split. These are the defaults; the matching env vars (SELLER_*, BUSINESS_STATE_CODE)
 * still override them, e.g. for a staging seller.
 */
export const SELLER = {
  legalName: 'M/s Janki International',
  gstin: '19EBNPA4275F1ZI',
  /** Invoice address lines, separated by `|`. */
  address: 'Gairkata Road, Binnaguri|Dist. Jalpaiguri, West Bengal 735203',
  email: 'jankii.international@gmail.com',
  phone: '+91 74774 59459',
  /** GST state code of the seller: 19 = West Bengal (intra-state → CGST + SGST, else IGST). */
  stateCode: '19',
} as const;
