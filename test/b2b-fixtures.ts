import { type INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser } from './auth';

/** A valid Maharashtra GSTIN (checksum ok), matching the test ADDRESS state 27. */
export const GSTIN_MH = '27AAPFU0939F1ZV';

/** Signed-in B2B_CUSTOMER with a business profile in the given status (default APPROVED). */
export async function createB2BUser(
  app: INestApplication,
  status: 'APPROVED' | 'PENDING' | 'REJECTED' = 'APPROVED',
) {
  const signedIn = await createSignedInUser(app, { role: 'B2B_CUSTOMER' });
  await app.get(PrismaService).businessProfile.create({
    data: {
      userId: signedIn.user.id,
      legalName: 'Acme Defence Supplies',
      gstin: GSTIN_MH,
      status,
      approvedAt: status === 'APPROVED' ? new Date() : null,
    },
  });
  return signedIn;
}
