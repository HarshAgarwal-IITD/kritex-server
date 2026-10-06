import { Module } from '@nestjs/common';
import { AdminQueriesController } from './admin/admin-queries.controller';
import { QueriesController } from './queries.controller';
import { QueriesService } from './queries.service';

@Module({
  controllers: [QueriesController, AdminQueriesController],
  providers: [QueriesService],
})
export class QueriesModule {}
