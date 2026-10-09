/**
 * Side-effect import: must come before anything that imports AppModule, because ConfigModule
 * validates (and caches) process.env when the module is first loaded. Configures bank transfer
 * so BANK_TRANSFER is offered to approved B2B customers (hold: BANK_TRANSFER_HOLD_DAYS default 7).
 */
export const BANK = {
  accountName: 'Kritex Test Pvt Ltd',
  accountNumber: '000111222333',
  ifsc: 'HDFC0000001',
  bankName: 'HDFC Bank',
};
process.env.BANK_TRANSFER_ACCOUNT_NAME = BANK.accountName;
process.env.BANK_TRANSFER_ACCOUNT_NUMBER = BANK.accountNumber;
process.env.BANK_TRANSFER_IFSC = BANK.ifsc;
process.env.BANK_TRANSFER_BANK_NAME = BANK.bankName;
