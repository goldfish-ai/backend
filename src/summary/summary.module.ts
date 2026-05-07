import { Module } from '@nestjs/common';
import { OpenAIModule } from '../openai/openai.module';
import { DocumentsModule } from '../documents/documents.module';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';

@Module({
  imports: [OpenAIModule, DocumentsModule],
  controllers: [SummaryController],
  providers: [SummaryService],
})
export class SummaryModule {}
