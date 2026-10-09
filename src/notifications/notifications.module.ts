import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationsService } from './notifications.service';

/**
 * Customer emails (OPS-1): listens to order / quote events and sends React Email templates via
 * MailService (Resend when RESEND_API_KEY is set, else SMTP / log; in-memory outbox in tests).
 * No routes.
 */
@Module({
  imports: [InvoicesModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
