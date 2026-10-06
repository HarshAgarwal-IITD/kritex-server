import { Module } from '@nestjs/common';
import { QueriesController } from './queries.controller';
import { QueriesService } from './queries.service';

@Module({
  controllers: [QueriesController],
  providers: [QueriesService],
})
export class QueriesModule {}
