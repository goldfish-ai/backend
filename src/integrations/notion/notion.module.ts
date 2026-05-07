import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../documents/documents.module';
import { NotionController } from './notion.controller';
import { NotionService } from './notion.service';

@Module({
  imports: [DocumentsModule],
  controllers: [NotionController],
  providers: [NotionService],
})
export class NotionModule {}
