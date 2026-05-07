import { Global, Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';

@Global()
@Module({
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
